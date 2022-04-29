// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

library Oracle {

    struct Observation {
        uint32 timestamp;
        // sigma (point_i * time_i - time_(i-1))
        int56 pointCumulative;
        uint160 secondsPerLiquidityCumulative_128;
        // true if this observation is inited
        bool init;
    }

    /// @notice generate a new observation from previours
    /// @param last The specified observation to be transformed
    /// @param timestamp The timestamp of the new observation, > last.timestamp
    /// @param currentPoint log 1.0001 of price
    /// @param liquidity The total in-range liquidity at the time of the new observation
    /// @return observation generated
    function newObservation(
        Observation memory last,
        uint32 timestamp,
        int24 currentPoint,
        uint128 liquidity
    ) private pure returns (Observation memory) {
        uint56 delta = uint56(timestamp - last.timestamp);
        return
            Observation({
                timestamp: timestamp,
                pointCumulative: last.pointCumulative + int56(currentPoint) * int56(delta),
                secondsPerLiquidityCumulative_128: last.secondsPerLiquidityCumulative_128 +
                    ((uint160(delta) << 128) / (liquidity > 0 ? liquidity : 1)),
                init: true
            });
    }

    function init(Observation[65535] storage self, uint32 timestamp)
        internal
        returns (uint16 queueLen, uint16 nextQueueLen)
    {
        self[0] = Observation({
            timestamp: timestamp,
            pointCumulative: 0,
            secondsPerLiquidityCumulative_128: 0,
            init: true
        });
        return (1, 1);
    }

    /// @notice call this function to append an price oracle observation data in the pool
    /// @param self circular-queue of observation data in array form
    /// @param currentIndex The index of the last observation in the array
    /// @param timestamp timestamp of new observation
    /// @param currentPoint current point of new observation (usually we append the point value just-before exchange)
    /// @param liquidity amount of liquidity of new observation
    /// @param queueLen max-length of circular queue
    /// @param nextQueueLen next max-length of circular queue, if length of queue increase over queueLen, queueLen will become nextQueueLen
    /// @return newIndex index of new observation
    /// @return newQueueLen queueLen value after appending
    function append(
        Observation[65535] storage self,
        uint16 currentIndex,
        uint32 timestamp,
        int24 currentPoint,
        uint128 liquidity,
        uint16 queueLen,
        uint16 nextQueueLen
    ) internal returns (uint16 newIndex, uint16 newQueueLen) {
        Observation memory last = self[currentIndex];

        if (last.timestamp == timestamp) return (currentIndex, queueLen);

        // if the conditions are right, we can bump the cardinality
        if (nextQueueLen > queueLen && currentIndex == (queueLen - 1)) {
            newQueueLen = nextQueueLen;
        } else {
            newQueueLen = queueLen;
        }

        newIndex = (currentIndex + 1) % newQueueLen;
        self[newIndex] = newObservation(last, timestamp, currentPoint, liquidity);
    }

    /// @notice expand the max-length of observation queue
    /// @param queueLen current max-length of queue
    /// @param nextQueueLen next max-length
    /// @return next max-length
    function expand(
        Observation[65535] storage self,
        uint16 queueLen,
        uint16 nextQueueLen
    ) internal returns (uint16) {
        require(queueLen > 0, 'LEN');
        
        if (nextQueueLen <= queueLen) return queueLen;
        
        for (uint16 i = queueLen; i < nextQueueLen; i++) self[i].timestamp = 1;
        return nextQueueLen;
    }

    function lte(
        uint32 time,
        uint32 a,
        uint32 b
    ) private pure returns (bool) {
        // if there hasn't been overflow, no need to adjust
        if (a <= time && b <= time) return a <= b;

        uint256 aAdjusted = a > time ? a : a + 2**32;
        uint256 bAdjusted = b > time ? b : b + 2**32;

        return aAdjusted <= bAdjusted;
    }
    
    /// @notice do binary search to find two neighbor observations for a target timestamp
    /// @param self observation queue in array form
    /// @param timestamp timestamp of current block
    /// @param targetTimestamp target time stamp
    /// @param currentIdx The index of the last observation in the array
    /// @param queueLen current max-length of queue
    /// @return beforeNeighbor before-or-at observation neighbor to target timestamp
    /// @return afterNeighbor after-or-at observation neighbor to target timestamp
    function findNeighbor(
        Observation[65535] storage self,
        uint32 timestamp,
        uint32 targetTimestamp,
        uint16 currentIdx,
        uint16 queueLen
    ) private view returns (Observation memory beforeNeighbor, Observation memory afterNeighbor) {
        uint256 l = (currentIdx + 1) % queueLen; // oldest observation
        uint256 r = l + queueLen - 1; // newest observation
        uint256 i;
        while (true) {
            i = (l + r) / 2;

            beforeNeighbor = self[i % queueLen];

            if (!beforeNeighbor.init) {
                l = i + 1;
                continue;
            }

            afterNeighbor = self[(i + 1) % queueLen];

            bool leftLessOrEq = lte(timestamp, beforeNeighbor.timestamp, targetTimestamp);

            if (leftLessOrEq && lte(timestamp, targetTimestamp, afterNeighbor.timestamp)) break;

            if (!leftLessOrEq) r = i - 1;
            else l = i + 1;
        }
    }

    /// @notice find two neighbor observations for a target timestamp
    /// @param self observation queue in array form
    /// @param timestamp timestamp of current block
    /// @param targetTimestamp target time stamp
    /// @param currentPoint current point of swap
    /// @param currentIndex The index of the last observation in the array
    /// @param liquidity liquidity of current point
    /// @param queueLen current max-length of queue
    /// @return beforeNeighbor before-or-at observation neighbor to target timestamp
    /// @return afterNeighbor after-or-at observation neighbor to target timestamp, 
    ///    if the targetTimestamp is later than last observation in queue, the afterNeighbor
    ///    observation does not exist in the queue
    function getTwoNeighborObservation(
        Observation[65535] storage self,
        uint32 timestamp,
        uint32 targetTimestamp,
        int24 currentPoint,
        uint16 currentIndex,
        uint128 liquidity,
        uint16 queueLen
    ) private view returns (Observation memory beforeNeighbor, Observation memory afterNeighbor) {
        beforeNeighbor = self[currentIndex];

        if (lte(timestamp, beforeNeighbor.timestamp, targetTimestamp)) {
            if (beforeNeighbor.timestamp == targetTimestamp) {
                return (beforeNeighbor, beforeNeighbor);
            } else {
                return (beforeNeighbor, newObservation(beforeNeighbor, targetTimestamp, currentPoint, liquidity));
            }
        }

        beforeNeighbor = self[(currentIndex + 1) % queueLen];
        if (!beforeNeighbor.init) beforeNeighbor = self[0];

        require(lte(timestamp, beforeNeighbor.timestamp, targetTimestamp), 'OLD');

        return findNeighbor(self, timestamp, targetTimestamp, currentIndex, queueLen);
    }

    /// @notice Returns the interpolation value of cumulative point and liquidity at some target timestamps (block.timestamp - secondsAgo[i])
    /// @dev Reverts if target timestamp is early than oldest observation in the queue
    /// @dev if you call this method twice with secondsAgos as 0 and 3600. and corresponding pointCumulatives value
    /// are pointCumulatives_3600 and pointCumulatives_0
    /// then, the average point of this pool during recent hour is 
    /// (pointCumulatives_3600 - pointCumulatives_0) / 3600
    /// @param self The observation circular queue in array form
    /// @param timestamp The current block timestamp
    /// @param secondsAgo target timestamp is timestamp-secondsAgo
    /// @param currentPoint The current point of pool
    /// @param currentIndex The index of the last observation in the array
    /// @param liquidity The liquidity of current point
    /// @param queueLen max-length of circular queue
    /// @return pointCumulative integral value of point(time) from 0 to each timestamp
    /// @return secondsPerLiquidityCumulative_128 integral value of 1/liquidity(time) from 0 to target timestamp
    function observeSingle(
        Observation[65535] storage self,
        uint32 timestamp,
        uint32 secondsAgo,
        int24 currentPoint,
        uint16 currentIndex,
        uint128 liquidity,
        uint16 queueLen
    ) internal view returns (int56 pointCumulative, uint160 secondsPerLiquidityCumulative_128) {
        if (secondsAgo == 0) {
            Observation memory last = self[currentIndex];
            if (last.timestamp != timestamp) last = newObservation(last, timestamp, currentPoint, liquidity);
            return (last.pointCumulative, last.secondsPerLiquidityCumulative_128);
        }

        uint32 targetTimestamp = timestamp - secondsAgo;

        (Observation memory beforeNeighbor, Observation memory afterNeighbor) =
            getTwoNeighborObservation(self, timestamp, targetTimestamp, currentPoint, currentIndex, liquidity, queueLen);

        if (targetTimestamp == beforeNeighbor.timestamp) {
            // we're at the left boundary
            return (beforeNeighbor.pointCumulative, beforeNeighbor.secondsPerLiquidityCumulative_128);
        } else if (targetTimestamp == afterNeighbor.timestamp) {
            // we're at the right boundary
            return (afterNeighbor.pointCumulative, afterNeighbor.secondsPerLiquidityCumulative_128);
        } else {
            // we're in the middle
            uint56 leftRightTimeDelta = afterNeighbor.timestamp - beforeNeighbor.timestamp;
            uint56 targetTimeDelta = targetTimestamp - beforeNeighbor.timestamp;
            return (
                beforeNeighbor.pointCumulative +
                    ((afterNeighbor.pointCumulative - beforeNeighbor.pointCumulative) / int56(leftRightTimeDelta)) *
                    int56(targetTimeDelta),
                beforeNeighbor.secondsPerLiquidityCumulative_128 +
                    uint160(
                        (uint256(
                            afterNeighbor.secondsPerLiquidityCumulative_128 - beforeNeighbor.secondsPerLiquidityCumulative_128
                        ) * targetTimeDelta) / leftRightTimeDelta
                    )
            );
        }
    }

    /// @notice Returns the integral value of point(time) and integral value of 1/liquidity(time)
    /// @dev Reverts if target timestamp is early than oldest observation in the queue
    /// @dev if you call this method with secondsAgos = [3600, 0]. the average point of this pool during recent hour is 
    /// (pointCumulatives[1] - pointCumulatives[0]) / 3600
    /// @param self The observation circular queue in array form
    /// @param timestamp The current block timestamp
    /// @param secondsAgos describe the target timestamp , targetTimestimp[i] = block.timestamp - secondsAgo[i]
    /// @param currentPoint The current point of pool
    /// @param currentIndex The index of the last observation in the array
    /// @param liquidity The liquidity of current point
    /// @param queueLen max-length of circular queue
    /// @return pointCumulatives integral value of point(time) from 0 to each timestamp
    /// @return secondsPerLiquidityCumulative_128s integral value of 1/liquidity(time) from 0 to target timestamp
    function observe(
        Observation[65535] storage self,
        uint32 timestamp,
        uint32[] memory secondsAgos,
        int24 currentPoint,
        uint16 currentIndex,
        uint128 liquidity,
        uint16 queueLen
    ) internal view returns (int56[] memory pointCumulatives, uint160[] memory secondsPerLiquidityCumulative_128s) {
        require(queueLen > 0, 'I');

        pointCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulative_128s = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            (pointCumulatives[i], secondsPerLiquidityCumulative_128s[i]) = observeSingle(
                self,
                timestamp,
                secondsAgos[i],
                currentPoint,
                currentIndex,
                liquidity,
                queueLen
            );
        }
    }
}