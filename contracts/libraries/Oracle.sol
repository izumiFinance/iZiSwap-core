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
    function find(
        Observation[65535] storage self,
        uint32 timestamp,
        uint32 targetTimestamp,
        uint16 currentIdx,
        uint16 queueLen
    ) private view returns (Observation memory lessOrEq, Observation memory greaterOrEq) {
        uint256 l = (currentIdx + 1) % queueLen; // oldest observation
        uint256 r = l + queueLen - 1; // newest observation
        uint256 i;
        while (true) {
            i = (l + r) / 2;

            lessOrEq = self[i % queueLen];

            if (!lessOrEq.init) {
                l = i + 1;
                continue;
            }

            greaterOrEq = self[(i + 1) % queueLen];

            bool leftLessOrEq = lte(timestamp, lessOrEq.timestamp, targetTimestamp);

            if (leftLessOrEq && lte(timestamp, targetTimestamp, greaterOrEq.timestamp)) break;

            if (!leftLessOrEq) r = i - 1;
            else l = i + 1;
        }
    }

    function getLeftRightObservation(
        Observation[65535] storage self,
        uint32 timestamp,
        uint32 targetTimestamp,
        int24 currentPoint,
        uint16 currentIndex,
        uint128 liquidity,
        uint16 queueLen
    ) private view returns (Observation memory leftOrAt, Observation memory rightOrAt) {
        // optimistically set before to the newest observation
        leftOrAt = self[currentIndex];

        // if the target is chronologically at or after the newest observation, we can early return
        if (lte(timestamp, leftOrAt.timestamp, targetTimestamp)) {
            if (leftOrAt.timestamp == targetTimestamp) {
                // if newest observation equals target, we're in the same block, so we can ignore atOrAfter
                return (leftOrAt, leftOrAt);
            } else {
                // otherwise, we need to transform
                return (leftOrAt, newObservation(leftOrAt, targetTimestamp, currentPoint, liquidity));
            }
        }

        // now, set before to the oldest observation
        leftOrAt = self[(currentIndex + 1) % queueLen];
        if (!leftOrAt.init) leftOrAt = self[0];

        // ensure that the target is chronologically at or after the oldest observation
        require(lte(timestamp, leftOrAt.timestamp, targetTimestamp), 'OLD');

        // if we've reached this point, we have to binary search
        return find(self, timestamp, targetTimestamp, currentIndex, queueLen);
    }

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

        (Observation memory leftOrAt, Observation memory rightOrAt) =
            getLeftRightObservation(self, timestamp, targetTimestamp, currentPoint, currentIndex, liquidity, queueLen);

        if (targetTimestamp == leftOrAt.timestamp) {
            // we're at the left boundary
            return (leftOrAt.pointCumulative, leftOrAt.secondsPerLiquidityCumulative_128);
        } else if (targetTimestamp == rightOrAt.timestamp) {
            // we're at the right boundary
            return (rightOrAt.pointCumulative, rightOrAt.secondsPerLiquidityCumulative_128);
        } else {
            // we're in the middle
            uint56 leftRightTimeDelta = rightOrAt.timestamp - leftOrAt.timestamp;
            uint56 targetTimeDelta = targetTimestamp - leftOrAt.timestamp;
            return (
                leftOrAt.pointCumulative +
                    ((rightOrAt.pointCumulative - leftOrAt.pointCumulative) / int56(leftRightTimeDelta)) *
                    int56(targetTimeDelta),
                leftOrAt.secondsPerLiquidityCumulative_128 +
                    uint160(
                        (uint256(
                            rightOrAt.secondsPerLiquidityCumulative_128 - leftOrAt.secondsPerLiquidityCumulative_128
                        ) * targetTimeDelta) / leftRightTimeDelta
                    )
            );
        }
    }

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