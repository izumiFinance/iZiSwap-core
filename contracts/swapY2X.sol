// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './interfaces/IiZiSwapPool.sol';
import './libraries/Liquidity.sol';
import './libraries/Point.sol';
import './libraries/PointBitmap.sol';
import './libraries/LogPowMath.sol';
import './libraries/MulDivMath.sol';
import './libraries/TwoPower.sol';
import './libraries/LimitOrder.sol';
import './libraries/SwapMathY2X.sol';
import './libraries/SwapMathX2Y.sol';
import './libraries/SwapMathY2XDesire.sol';
import './libraries/SwapMathX2YDesire.sol';
import './libraries/UserEarn.sol';
import './libraries/TokenTransfer.sol';
import './libraries/State.sol';
import './libraries/Oracle.sol';
import './libraries/OrderOrEndpoint.sol';
import './libraries/MaxMinMath.sol';
import './interfaces/IiZiSwapCallback.sol';
import 'hardhat/console.sol';

contract SwapY2XModule {

    using Liquidity for mapping(bytes32 =>Liquidity.Data);
    using Liquidity for Liquidity.Data;
    using Point for mapping(int24 =>Point.Data);
    using Point for Point.Data;
    using PointBitmap for mapping(int16 =>uint256);
    using LimitOrder for LimitOrder.Data;
    using UserEarn for UserEarn.Data;
    using UserEarn for mapping(bytes32 =>UserEarn.Data);
    using SwapMathY2X for SwapMathY2X.RangeRetState;
    using SwapMathX2Y for SwapMathX2Y.RangeRetState;
    using Oracle for Oracle.Observation[65535];
    using OrderOrEndpoint for mapping(int24 =>int24);

    int24 internal constant LEFT_MOST_PT = -800000;
    int24 internal constant RIGHT_MOST_PT = 800000;

    /// @notice left most point regularized by pointDelta
    int24 public leftMostPt;
    /// @notice right most point regularized by pointDelta
    int24 public rightMostPt;
    /// @notice maximum liquidSum for each point, see points() in IiZiSwapPool or library Point
    uint128 public maxLiquidPt;

    /// @notice address of iZiSwapFactory
    address public factory;

    /// @notice address of tokenX
    address public tokenX;

    /// @notice address of tokenY
    address public tokenY;

    /// @notice fee amount of this swap pool, 3000 means 0.3%
    uint24 public fee;

    /// @notice minimum number of distance between initialized or limitorder points 
    int24 public pointDelta;

    /// @notice The fee growth as a 128-bit fixpoing fees of tokenX collected per 1 liquidity of the pool
    uint256 public feeScaleX_128;
    /// @notice The fee growth as a 128-bit fixpoing fees of tokenY collected per 1 liquidity of the pool
    uint256 public feeScaleY_128;

    uint160 sqrtRate_96;

    /// @notice some values of pool
    /// see library State or IiZiSwapPool#state for more infomation
    State public state;

    /// @notice the information about a liquidity by the liquidity's key
    mapping(bytes32 =>Liquidity.Data) public liquidities;

    /// @notice 256 packed point (orderOrEndpoint>0) boolean values. See PointBitmap for more information
    mapping(int16 =>uint256) public pointBitmap;

    /// @notice returns infomation of a point in the pool, see Point library of IiZiSwapPool#poitns for more information
    mapping(int24 =>Point.Data) public points;
    /// @notice infomation about a point whether has limit order and whether as an liquidity's endpoint
    mapping(int24 =>int24) public orderOrEndpoint;
    /// @notice limitOrder info on a given point
    mapping(int24 =>LimitOrder.Data) public limitOrderData;
    /// @notice information about a user's limit order (sell tokenY and earn tokenX)
    mapping(bytes32 => UserEarn.Data) public userEarnX;
    /// @notice information about a user's limit order (sell tokenX and earn tokenY)
    mapping(bytes32 => UserEarn.Data) public userEarnY;
    /// @notice observation data array
    Oracle.Observation[65535] public observations;
    
    uint256 public totalFeeXCharged;
    uint256 public totalFeeYCharged;

    address private  original;

    address private swapModuleX2Y;
    address private swapModuleY2X;
    address private liquidityModule;

    /// @notice percent to charge from miner's fee
    uint24 public immutable feeChargePercent = 50;

    struct SwapCache {
        uint256 currFeeScaleX_128;
        uint256 currFeeScaleY_128;
        bool finished;
        uint160 _sqrtRate_96;
        int24 pointDelta;
        int24 currentOrderOrEndPoint;
        int24 startPoint;
        uint128 startLiquidity;
        uint32 timestamp;
    }

    // delta cannot be int128.min and it can be proofed that
    // liquidDelta of any one point will not be int128.min
    function liquidityAddDelta(uint128 l, int128 delta) private pure returns (uint128 nl) {
        if (delta < 0) {
            nl = l - uint128(-delta);
        } else {
            nl = l + uint128(delta);
        }
    }
    
    function balanceX() private view returns (uint256) {
        (bool success, bytes memory data) =
            tokenX.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, address(this)));
        require(success && data.length >= 32);
        return abi.decode(data, (uint256));
    }

    function balanceY() private view returns (uint256) {
        (bool success, bytes memory data) =
            tokenY.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, address(this)));
        require(success && data.length >= 32);
        return abi.decode(data, (uint256));
    }

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
    ) external returns (uint256 amountX, uint256 amountY) {
        
        require(amount > 0, "AP");
        highPt = MaxMinMath.min(highPt, rightMostPt);
        amountX = 0;
        amountY = 0;
        State memory st = state;
        SwapCache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pointDelta = pointDelta;
        cache.currentOrderOrEndPoint = orderOrEndpoint.getOrderOrEndptVal(st.currentPoint, cache.pointDelta);
        cache.startPoint = st.currentPoint;
        cache.startLiquidity = st.liquidity;
        cache.timestamp = uint32(block.number);
        while (st.currentPoint < highPt && !cache.finished) {

            if (cache.currentOrderOrEndPoint & 2 > 0) {
                uint128 amountNoFee = uint128(uint256(amount) * (1e6 - fee) / 1e6);
                if (amountNoFee > 0) {
                    // clear limit order first
                    LimitOrder.Data storage od = limitOrderData[st.currentPoint];
                    uint128 currX = od.sellingX;
                    (uint128 costY, uint128 acquireX) = SwapMathY2X.y2XAtPrice(
                        amountNoFee, st.sqrtPrice_96, currX
                    );
                    if (acquireX < currX || costY >= amountNoFee) {
                        cache.finished = true;
                    }
                    uint128 feeAmount;
                    if (costY >= amountNoFee) {
                        feeAmount = amount - costY;
                    } else {
                        feeAmount = uint128(uint256(costY) * fee / (1e6 - fee));
                        uint256 mod = uint256(costY) * fee % (1e6 - fee);
                        if (mod > 0) {
                            feeAmount += 1;
                        }
                    }
                    totalFeeYCharged += feeAmount;
                    amount -= (costY + feeAmount);
                    amountY = amountY + costY + feeAmount;
                    amountX += acquireX;
                    currX -= acquireX;
                    od.sellingX = currX;
                    od.earnY += costY;
                    od.accEarnY += costY;
                    if (od.sellingY == 0 && currX == 0) {
                        int24 newVal = cache.currentOrderOrEndPoint & 1;
                        orderOrEndpoint.setOrderOrEndptVal(st.currentPoint, cache.pointDelta, newVal);
                        if (newVal == 0) {
                            pointBitmap.setZero(st.currentPoint, cache.pointDelta);
                        }
                    }
                } else {
                    cache.finished = true;
                }
            }

            if (cache.finished) {
                break;
            }

            int24 nextPoint = pointBitmap.nearestRightOneOrBoundary(st.currentPoint, cache.pointDelta);
            int24 nextVal = orderOrEndpoint.getOrderOrEndptVal(nextPoint, cache.pointDelta);
            if (nextPoint > highPt) {
                nextVal = 0;
                nextPoint = highPt;
            }

            // in [st.currentPoint, nextPoint)
            if (st.liquidity == 0) {
                // no liquidity in the range [st.currentPoint, nextPoint)
                st.currentPoint = nextPoint;
                st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currentPoint);
                if (nextVal & 1 > 0) {
                    Point.Data storage endPt = points[nextPoint];
                    // pass next point from left to right
                    endPt.passEndpoint(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    // we should add delta liquid of nextPoint
                    int128 liquidDelta = endPt.liquidDelta;
                    st.liquidity = liquidityAddDelta(st.liquidity, liquidDelta);
                    st.liquidityX = st.liquidity;
                }
                cache.currentOrderOrEndPoint = nextVal;
            } else {
                // amount > 0
                uint128 amountNoFee = uint128(uint256(amount) * (1e6 - fee) / 1e6);
                if (amountNoFee > 0) {
                    SwapMathY2X.RangeRetState memory retState = SwapMathY2X.y2XRange(
                        st, nextPoint, cache._sqrtRate_96, amountNoFee
                    );

                    cache.finished = retState.finished;
                    uint128 feeAmount;
                    if (retState.costY >= amountNoFee) {
                        feeAmount = amount - retState.costY;
                    } else {
                        feeAmount = uint128(uint256(retState.costY) * fee / (1e6 - fee));
                        uint256 mod = uint256(retState.costY) * fee % (1e6 - fee);
                        if (mod > 0) {
                            feeAmount += 1;
                        }
                    }

                    amountX += retState.acquireX;
                    amountY = amountY + retState.costY + feeAmount;
                    amount -= (retState.costY + feeAmount);

                    uint256 chargedFeeAmount = uint256(feeAmount) * feeChargePercent / 100;
                    totalFeeYCharged += chargedFeeAmount;

                    cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + MulDivMath.mulDivFloor(feeAmount - chargedFeeAmount, TwoPower.Pow128, st.liquidity);

                    st.currentPoint = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.liquidityX = retState.liquidityX;
                } else {
                    cache.finished = true;
                }

                if (st.currentPoint == nextPoint) {
                    if ((nextVal & 1) > 0) {
                        Point.Data storage endPt = points[nextPoint];
                        // pass next point from left to right
                        endPt.passEndpoint(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                        st.liquidity = liquidityAddDelta(st.liquidity, endPt.liquidDelta);
                    }
                    st.liquidityX = st.liquidity;
                }
                if (st.currentPoint == nextPoint) {
                    cache.currentOrderOrEndPoint = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currentOrderOrEndPoint = 0;
                }
            }
        }
        if (cache.startPoint != st.currentPoint) {
            (st.observationCurrentIndex, st.observationQueueLen) = observations.append(
                st.observationCurrentIndex,
                cache.timestamp,
                cache.startPoint,
                cache.startLiquidity,
                st.observationQueueLen,
                st.observationNextQueueLen
            );
        }
        // write back fee scale, no fee of x
        feeScaleY_128 = cache.currFeeScaleY_128;
        // write back state
        state = st;
        require(amountX > 0, "PR");
        // transfer x to trader
        TokenTransfer.transferToken(tokenX, recipient, amountX);
        // trader pay y
        require(amountY > 0, "PP");
        uint256 by = balanceY();
        IiZiSwapCallback(msg.sender).swapY2XCallback(amountX, amountY, data);
        require(balanceY() >= by + amountY, "YE");
        
    }

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
    ) external returns (uint256 amountX, uint256 amountY) {
        
        require (desireX > 0, "XP");
        highPt = MaxMinMath.min(highPt, rightMostPt);
        amountX = 0;
        amountY = 0;
        State memory st = state;
        SwapCache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pointDelta = pointDelta;
        cache.currentOrderOrEndPoint = orderOrEndpoint.getOrderOrEndptVal(st.currentPoint, cache.pointDelta);
        cache.startPoint = st.currentPoint;
        cache.startLiquidity = st.liquidity;
        cache.timestamp = uint32(block.number);
        while (st.currentPoint < highPt && !cache.finished) {
            if (cache.currentOrderOrEndPoint & 2 > 0) {
                // clear limit order first
                LimitOrder.Data storage od = limitOrderData[st.currentPoint];
                uint128 currX = od.sellingX;
                (uint128 costY, uint128 acquireX) = SwapMathY2XDesire.y2XAtPrice(
                    desireX, st.sqrtPrice_96, currX
                );
                if (acquireX >= desireX) {
                    cache.finished = true;
                }
                uint256 feeAmount = MulDivMath.mulDivCeil(costY, fee, 1e6 - fee);
                totalFeeYCharged += feeAmount;
                desireX = (desireX <= acquireX) ? 0 : desireX - acquireX;
                amountY += (costY + feeAmount);
                amountX += acquireX;
                currX -= acquireX;
                od.sellingX = currX;
                od.earnY += costY;
                od.accEarnY += costY;
                if (od.sellingY == 0 && currX == 0) {
                    int24 newVal = cache.currentOrderOrEndPoint & 1;
                    orderOrEndpoint.setOrderOrEndptVal(st.currentPoint, cache.pointDelta, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currentPoint, cache.pointDelta);
                    }
                }
            }

            if (cache.finished) {
                break;
            }
            int24 nextPoint = pointBitmap.nearestRightOneOrBoundary(st.currentPoint, cache.pointDelta);
            int24 nextVal = orderOrEndpoint.getOrderOrEndptVal(nextPoint, cache.pointDelta);
            if (nextPoint > highPt) {
                nextVal = 0;
                nextPoint = highPt;
            }
            // in [st.currentPoint, nextPoint)
            if (st.liquidity == 0) {
                // no liquidity in the range [st.currentPoint, nextPoint)
                st.currentPoint = nextPoint;
                st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currentPoint);
                if (nextVal & 1 > 0) {
                    Point.Data storage endPt = points[nextPoint];
                    // pass next point from left to right
                    endPt.passEndpoint(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    // we should add delta liquid of nextPoint
                    int128 liquidDelta = endPt.liquidDelta;
                    st.liquidity = liquidityAddDelta(st.liquidity, liquidDelta);
                    st.liquidityX = st.liquidity;
                }
                cache.currentOrderOrEndPoint = nextVal;
            } else {
                // desireX > 0
                if (desireX > 0) {
                    SwapMathY2XDesire.RangeRetState memory retState = SwapMathY2XDesire.y2XRange(
                        st, nextPoint, cache._sqrtRate_96, desireX
                    );
                    cache.finished = retState.finished;
                    uint256 feeAmount = MulDivMath.mulDivCeil(retState.costY, fee, 1e6 - fee);
                    uint256 chargedFeeAmount = feeAmount * feeChargePercent / 100;
                    totalFeeYCharged += chargedFeeAmount;

                    amountX += retState.acquireX;
                    amountY += (retState.costY + feeAmount);
                    desireX -= MaxMinMath.min(desireX, retState.acquireX);
                    
                    cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + MulDivMath.mulDivFloor(feeAmount - chargedFeeAmount, TwoPower.Pow128, st.liquidity);

                    st.currentPoint = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.liquidityX = retState.liquidityX;
                } else {
                    cache.finished = true;
                }

                if (st.currentPoint == nextPoint) {
                    if ((nextVal & 1) > 0) {
                        Point.Data storage endPt = points[nextPoint];
                        // pass next point from left to right
                        endPt.passEndpoint(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                        st.liquidity = liquidityAddDelta(st.liquidity, endPt.liquidDelta);
                    }
                    st.liquidityX = st.liquidity;
                }
                if (st.currentPoint == nextPoint) {
                    cache.currentOrderOrEndPoint = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currentOrderOrEndPoint = 0;
                }
            }
        }
        if (cache.startPoint != st.currentPoint) {
            (st.observationCurrentIndex, st.observationQueueLen) = observations.append(
                st.observationCurrentIndex,
                cache.timestamp,
                cache.startPoint,
                cache.startLiquidity,
                st.observationQueueLen,
                st.observationNextQueueLen
            );
        }
        // write back fee scale, no fee of x
        feeScaleY_128 = cache.currFeeScaleY_128;
        // write back state
        state = st;
        // transfer x to trader
        require(amountX > 0, "PR");
        TokenTransfer.transferToken(tokenX, recipient, amountX);
        // trader pay y
        require(amountY > 0, "PP");
        uint256 by = balanceY();
        IiZiSwapCallback(msg.sender).swapY2XCallback(amountX, amountY, data);
        require(balanceY() >= by + amountY, "YE");
        
    }

}