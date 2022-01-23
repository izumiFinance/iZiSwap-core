pragma solidity ^0.8.4;

interface IiZiSwapPool {

    /// @notice Returns the information about a liquidity by the liquidity's key
    /// @param key The liquidity's key is a hash of a preimage composed by the miner(owner), pointLeft and pointRight
    /// @return liquidity The amount of liquidity,
    /// Returns lastFeeScaleX_128 fee growth of tokenX inside the range as of the last mint/burn/collect,
    /// Returns lastFeeScaleY_128 fee growth of tokenY inside the range as of the last mint/burn/collect,
    /// Returns remainFeeX the computed amount of tokenX miner can collect as of the last mint/burn/collect,
    /// Returns remainFeeY the computed amount of tokenY miner can collect as of the last mint/burn/collect
    function liquidities(bytes32 key)
        external
        view
        returns (
            uint128 liquidity,
            uint256 lastFeeScaleX_128,
            uint256 lastFeeScaleY_128,
            uint256 remainFeeX,
            uint256 remainFeeY
        );
    
    /// @notice return the information about a user's limit order (sell tokenY and earn tokenX)
    /// @param key the limit order's key is a hash of a preimage composed by the seller, point
    /// @return lastAccEarn total amount of tokenX earned by all users at this point as of the last add/dec/collect
    /// Returns sellingRemain amount of tokenY not selled in this limit order
    /// Returns sellingDec amount of tokenY decreased by seller from this limit order
    /// Returns earn amount of tokenX earned in this limit order not assigned
    /// Returns earnAssign assigned amount of tokenX earned in this limit order
    function userEarnX(bytes32 key)
        external
        view
        returns (
            uint256 lastAccEarn,
            uint256 sellingRemain,
            uint256 sellingDec,
            uint256 earn,
            uint256 earnAssign
        );
    
    /// @notice return the information about a user's limit order (sell tokenX and earn tokenY)
    /// @param key the limit order's key is a hash of a preimage composed by the seller, point
    /// @return lastAccEarn total amount of tokenY earned by all users at this point as of the last add/dec/collect
    /// Returns sellingRemain amount of tokenX not selled in this limit order
    /// Returns sellingDec amount of tokenX decreased by seller from this limit order
    /// Returns earn amount of tokenY earned in this limit order not assigned
    /// Returns earnAssign assigned amount of tokenY earned in this limit order
    function userEarnY(bytes32 key)
        external
        view
        returns (
            uint256 lastAccEarn,
            uint256 sellingRemain,
            uint256 sellingDec,
            uint256 earn,
            uint256 earnAssign
        );
    
    /// @notice mark a given amount of tokenY in a limitorder(sellx and earn y) as assigned
    /// @param point point (log Price) of seller's limit order,be sure to be times of pointDelta
    /// @param assignY max amount of tokenY to mark assigned
    /// @return actualAssignY actual amount of tokenY marked
    function assignLimOrderEarnY(
        int24 point,
        uint256 assignY
    ) external returns(uint256 actualAssignY);
    
    /// @notice mark a given amount of tokenX in a limitorder(selly and earn x) as assigned
    /// @param point point (log Price) of seller's limit order,be sure to be times of pointDelta
    /// @param assignX max amount of tokenX to mark assigned
    /// @return actualAssignX actual amount of tokenX marked
    function assignLimOrderEarnX(
        int24 point,
        uint256 assignX
    ) external returns(uint256 actualAssignX);

    /// @notice decrease limitorder of selling X
    /// @param point point of seller's limit order, be sure to be times of pointDelta
    /// @param deltaX max amount of tokenX seller wants to decrease
    /// @return actualDeltaX actual amount of tokenX decreased
    function decLimOrderWithX(
        int24 point,
        uint128 deltaX
    ) external returns (uint128 actualDeltaX);
    
    /// @notice decrease limitorder of selling Y
    /// @param point point of seller's limit order, be sure to be times of pointDelta
    /// @param deltaY max amount of tokenY seller wants to decrease
    /// @return actualDeltaY actual amount of tokenY decreased
    function decLimOrderWithY(
        int24 point,
        uint128 deltaY
    ) external returns (uint128 actualDeltaY);
    
    /// @notice add a limit order (selling x) in the pool
    /// @param recipient owner of the limit order
    /// @param point point of the order, be sure to be times of pointDelta
    /// @param amountX amount of tokenX to sell
    /// @param data Any data that should be passed through to the callback
    /// @return orderX actual added amount of tokenX
    /// Returns acquireY amount of tokenY acquired if there is a limit order to sell y before adding
    function addLimOrderWithX(
        address recipient,
        int24 point,
        uint128 amountX,
        bytes calldata data
    ) external returns (uint128 orderX, uint256 acquireY);

    /// @notice add a limit order (selling y) in the pool
    /// @param recipient owner of the limit order
    /// @param point point of the order, be sure to be times of pointDelta
    /// @param amountY amount of tokenY to sell
    /// @param data Any data that should be passed through to the callback
    /// @return orderY actual added amount of tokenY
    /// Returns acquireX amount of tokenX acquired if there exists a limit order to sell x before adding
    function addLimOrderWithY(
        address recipient,
        int24 point,
        uint128 amountY,
        bytes calldata data
    ) external returns (uint128 orderY, uint256 acquireX);

    /// @notice collect earned or decreased token from limit order
    /// @param recipient address to benefit
    /// @param point point of limit order, be sure to be times of pointDelta
    /// @param collectDec max amount of decreased selling token to collect
    /// @param collectEarn max amount of earned token to collect
    /// @param isEarnY direction of this limit order, true for sell y, false for sell x
    /// @return actualCollectDec actual amount of decresed selling token collected
    /// Returns actualCollectEarn actual amount of earned token collected
    function collectLimOrder(
        address recipient, int24 point, uint256 collectDec, uint256 collectEarn, bool isEarnY
    ) external returns(uint256 actualCollectDec, uint256 actualCollectEarn);

    /// @notice add liquidity to the pool
    /// @param recipient Newly created liquidity will belong to this address
    /// @param leftPt left endpoint of the liquidity, be sure to be times of pointDelta
    /// @param rightPt right endpoint of the liquidity, be sure to be times of pointDelta
    /// @param liquidDelta amount of liquidity to add
    /// @param data Any data that should be passed through to the callback
    /// @return amountX The amount of tokenX that was paid for the liquidity. Matches the value in the callback
    /// @return amountY The amount of tokenY that was paid for the liquidity. Matches the value in the callback
    function mint(
        address recipient,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta,
        bytes calldata data
    ) external returns (uint128 amountX, uint128 amountY);

    /// @notice decrease a given amount of liquidity from msg.sender's liquidities
    /// @param leftPt left endpoint of the liquidity
    /// @param rightPt right endpoint of the liquidity
    /// @param liquidDelta amount of liquidity to burn
    /// @return amountX The amount of tokenX should be refund after burn
    /// @return amountY The amount of tokenY should be refund after burn
    function burn(
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta
    ) external returns (uint256 amountX, uint256 amountY);

    /// @notice Collects tokens (fee or refunded after burn) from a liquidity
    /// @param recipient The address which should receive the collected tokens
    /// @param leftPt left endpoint of the liquidity
    /// @param rightPt right endpoint of the liquidity
    /// @param amountXLim max amount of tokenX the owner wants to collect
    /// @param amountYLim max amount of tokenY the owner wants to collect
    /// @return actualAmountX The amount tokenX collected
    /// @return actualAmountY The amount tokenY collected
    function collect(
        address recipient,
        int24 leftPt,
        int24 rightPt,
        uint256 amountXLim,
        uint256 amountYLim
    ) external returns (uint256 actualAmountX, uint256 actualAmountY);

    /// @notice Swap tokenY for tokenX， given max amount of tokenY user willing to pay
    /// @param recipient The address to receive tokenX
    /// @param amount The max amount of tokenY user willing to pay
    /// @param highPt the highest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX payed
    /// @return amountY amount of tokenY acquired
    function swapY2X(
        address recipient,
        uint128 amount,
        int24 highPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    /// @notice Swap tokenY for tokenX， given amount of tokenX user desires
    /// @param recipient The address to receive tokenX
    /// @param desireX The amount of tokenX user desires
    /// @param highPt the highest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX payed
    /// @return amountY amount of tokenY acquired
    function swapY2XDesireX(
        address recipient,
        uint128 desireX,
        int24 highPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    /// @notice Swap tokenX for tokenY， given max amount of tokenX user willing to pay
    /// @param recipient The address to receive tokenY
    /// @param amount The max amount of tokenX user willing to pay
    /// @param lowPt the lowest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX acquired
    /// @return amountY amount of tokenY payed
    function swapX2Y(
        address recipient,
        uint128 amount,
        int24 lowPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    /// @notice Swap tokenX for tokenY， given amount of tokenY user desires
    /// @param recipient The address to receive tokenY
    /// @param desireY The amount of tokenY user desires
    /// @param lowPt the lowest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX acquired
    /// @return amountY amount of tokenY payed
    function swapX2YDesireY(
        address recipient,
        uint128 desireY,
        int24 lowPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    /// @notice some values of pool
    /// @return sqrtPrice_96 a 96 fixpoing number describe the sqrt value of current price(tokenX/tokenY)
    /// @return currentPoint The current point of the pool, 1.0001 ^ currentPoint = price
    /// @return currX amount of tokenX (from liquidity) on the currentPoint, this value is meaningless if allX is true
    /// @return currY amount of tokenY (from liquidity) on the currentPoint, this value is meaningless if allX is true
    /// @return liquidity liquidity on the currentPoint (currX * sqrtPrice + currY / sqrtPrice)
    /// @return allX whether there is no tokenY on the currentPoint
    /// @return observationCurrentIndex The index of the last oracle observation that was written,
    /// @return observationQueueLen The current maximum number of observations stored in the pool,
    /// @return observationNextQueueLen The next maximum number of observations, to be updated when the observation.
    /// @return locked whether the pool is locked (only used for checking reentrance)
    function state()
        external view
        returns(
            uint160 sqrtPrice_96,
            int24 currentPoint,
            uint256 currX,
            uint256 currY,
            uint128 liquidity,
            bool allX,
            uint16 observationCurrentIndex,
            uint16 observationQueueLen,
            uint16 observationNextQueueLen,
            bool locked
        );
    
    /// @notice limitOrder info on a given point
    /// @param point the given point 
    /// @return sellingX total amount of tokenX selling on the point
    /// @return accEarnX total amount of earned tokenX(via selling tokenY) by all users at this point as of the last swap
    /// @return sellingY total amount of tokenYselling on the point
    /// @return accEarnY total amount of earned tokenY(via selling tokenX) by all users at this point as of the last swap
    /// @return earnX total amount of unclaimed earned tokenX
    /// @return earnY total amount of unclaimed earned tokenY
    function limitOrderData(int24 point)
        external view
        returns(
            uint256 sellingX,
            uint256 accEarnX,
            uint256 sellingY,
            uint256 accEarnY,
            uint256 earnX,
            uint256 earnY
        );
    
    /// @notice query infomation about a point whether has limit order and whether as an liquidity's endpoint
    /// @param point point to query
    /// @return val endpoint for val&1>0 and has limit order for val&2 > 0
    function orderOrEndpoint(int24 point) external returns(int24 val);

    /// @notice Returns observation data about a specific index
    /// @param index the index of observation array
    /// @return timestamp The timestamp of the observation,
    /// @return pointCumulative the point multiplied by seconds elapsed for the life of the pool as of the observation timestamp,
    /// @return secondsPerLiquidityCumulative_128 the seconds per in range liquidity for the life of the pool as of the observation timestamp,
    /// @return init whether the observation has been initialized and the above values are safe to use
    function observations(uint256 index)
        external
        view
        returns (
            uint32 timestamp,
            int56 pointCumulative,
            uint160 secondsPerLiquidityCumulative_128,
            bool init
        );

    /// @notice returns infomation of a point in the pool
    /// @param point the point
    /// @return liquidAcc the total amount of liquidity that uses the point either as left endpoint or right endpoint
    /// @return liquidDelta how much liquidity changes when the pool price crosses the point from left to right
    /// @return feeScaleXBeyond_128 the fee growth on the other side of the point from the current point in tokenX
    /// @return feeScaleYBeyond_128 the fee growth on the other side of the point from the current point in tokenY
    /// @return isEndpt whether the point is an endpoint of a some miner's liquidity, true if liquidAcc > 0
    function points(int24 point)
        external
        view
        returns (
            uint128 liquidAcc,
            int128 liquidDelta,
            uint256 feeScaleXBeyond_128,
            uint256 feeScaleYBeyond_128,
            bool isEndpt
        );

    /// @notice Returns 256 packed point (statusVal>0) boolean values. See PointBitmap for more information
    function pointBitmap(int16 wordPosition) external view returns (uint256);

    /// @notice Returns the integral value of point(time) and integral value of 1/liquidity(time)
    ///     at some target timestamps (block.timestamp - secondsAgo[i])
    /// @dev Reverts if target timestamp is early than oldest observation in the queue
    /// @dev if you call this method with secondsAgos = [3600, 0]. the average point of this pool during recent hour is 
    /// (pointCumulatives[1] - pointCumulatives[0]) / 3600
    /// @param secondsAgos describe the target timestamp , targetTimestimp[i] = block.timestamp - secondsAgo[i]
    /// @return pointCumulatives integral value of point(time) from 0 to each target timestamp
    /// @return secondsPerLiquidityCumulative_128s integral value of 1/liquidity(time) from 0 to each target timestamp
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory pointCumulatives, uint160[] memory secondsPerLiquidityCumulative_128s);
    
    /// @notice expand max-length of observation queue
    /// @param newNextQueueLen new value of observationNextQueueLen, which should be greater than current observationNextQueueLen
    function expandObservationQueue(uint16 newNextQueueLen) external;
}