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
import './libraries/TokenTransfer.sol';
import './libraries/UserEarn.sol';
import './libraries/State.sol';
import './libraries/Oracle.sol';
import './interfaces/IiZiSwapCallback.sol';

import 'hardhat/console.sol';

contract SwapX2YModule {

    // TODO following usings may need modify
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

    // TODO following values need change
    int24 internal constant LEFT_MOST_PT = -800000;
    int24 internal constant RIGHT_MOST_PT = 800000;

    int24 private leftMostPt;
    int24 private rightMostPt;
    uint128 private maxLiquidPt;

    address public factory;
    address public tokenX;
    address public tokenY;
    uint24 public fee;
    int24 public pointDelta;

    uint256 public feeScaleX_128;
    uint256 public feeScaleY_128;

    uint160 public sqrtRate_96;

    // struct State {
    //     uint160 sqrtPrice_96;
    //     int24 currentPoint;
    //     uint256 currX;
    //     uint256 currY;
    //     // liquidity from currentPoint to right
    //     uint128 liquidity;
    //     bool allX;
    //     bool locked;
    // }
    State public state;

    struct Cache {
        uint256 currFeeScaleX_128;
        uint256 currFeeScaleY_128;
        bool finished;
        uint160 _sqrtRate_96;
        int24 pd;
        int24 currVal;
        int24 startPoint;
        uint128 startLiquidity;
        uint32 timestamp;
    }
    // struct WithdrawRet {
    //     uint256 x;
    //     uint256 y;
    //     uint256 xc;
    //     uint256 yc;
    //     uint256 currX;
    //     uint256 currY;
    // }

    /// TODO: following mappings may need modify
    mapping(bytes32 =>Liquidity.Data) public liquidities;
    mapping(int16 =>uint256) pointBitmap;
    mapping(int24 =>Point.Data) points;
    mapping(int24 =>int24) public orderOrEndpoint;
    mapping(int24 =>LimitOrder.Data) public limitOrderData;
    mapping(bytes32 => UserEarn.Data) userEarnX;
    mapping(bytes32 => UserEarn.Data) userEarnY;
    Oracle.Observation[65535] public observations;
    
    address private  original;

    address private swapModuleX2Y;
    address private swapModuleY2X;
    address private mintMudule;
    // address private immutable original;

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

    function getStatusVal(int24 point, int24 pd) internal view returns(int24 val) {
        if (point % pd != 0) {
            return 0;
        }
        val = orderOrEndpoint[point / pd];
    }
    function setStatusVal(int24 point, int24 pd, int24 val) internal {
        orderOrEndpoint[point / pd] = val;
    }

    /// @dev swap sell tokenx and buy y
    /// @param recipient address of actual trader
    /// @param amount amount of x to sell from trader
    /// @param lowPt point of lowest price of y
    /// @param data calldata for user's callback to transfer x
    /// @return amountX amountY token x trader actually sale and token y trader actually acquired
    function swapX2Y(
        address recipient,
        uint128 amount,
        int24 lowPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY) {
        
        // todo we will consider -amount of desired y later
        require(amount > 0, "AP");
        require(lowPt >= leftMostPt, "LO");
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = pointDelta;
        cache.currVal = getStatusVal(st.currentPoint, cache.pd);
        cache.startPoint = st.currentPoint;
        cache.startLiquidity = st.liquidity;
        cache.timestamp = uint32(block.number);
        while (lowPt <= st.currentPoint && !cache.finished) {
            // clear limit order first
            if (cache.currVal & 2 > 0) {
                LimitOrder.Data storage od = limitOrderData[st.currentPoint];
                uint256 currY = od.sellingY;
                (uint128 costX, uint256 acquireY) = SwapMathX2Y.x2YAtPrice(
                    amount, st.sqrtPrice_96, currY
                );
                if (acquireY < currY || costX >= amount) {
                    cache.finished = true;
                }
                amount -= costX;
                amountX = amountX + costX;
                amountY += acquireY;
                currY -= acquireY;
                od.sellingY = currY;
                od.earnX += costX;
                od.accEarnX += costX;
                if (od.sellingX == 0 && currY == 0) {
                    int24 newVal = cache.currVal & 1;
                    setStatusVal(st.currentPoint, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currentPoint, cache.pd);
                    }
                }
            }
            if (cache.finished) {
                break;
            }
            int24 searchStart = st.currentPoint - 1;
            // second, clear the liquid if the currentPoint is an endpoint
            if (cache.currVal & 1 > 0) {
                uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
                if (amountNoFee > 0) {
                    if (st.liquidity > 0) {
                        SwapMathX2Y.RangeRetState memory retState = SwapMathX2Y.x2YRange(
                            st,
                            st.currentPoint,
                            cache._sqrtRate_96,
                            amountNoFee
                        );
                        cache.finished = retState.finished;
                        uint128 feeAmount;
                        if (retState.costX >= amountNoFee) {
                            feeAmount = amount - retState.costX;
                        } else {
                            feeAmount = uint128(uint256(retState.costX) * fee / 1e6);
                            uint256 mod = uint256(retState.costX) * fee % 1e6;
                            if (mod > 0) {
                                feeAmount += 1;
                            }
                        }
                        cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + MulDivMath.mulDivFloor(feeAmount, TwoPower.Pow128, st.liquidity);
                        amountX = amountX + retState.costX + feeAmount;
                        amountY += retState.acquireY;
                        amount -= (retState.costX + feeAmount);
                        st.currentPoint = retState.finalPt;
                        st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                        st.allX = retState.finalAllX;
                        st.currX = retState.finalCurrX;
                        st.currY = retState.finalCurrY;
                    }
                    if (!cache.finished) {
                        Point.Data storage pointdata = points[st.currentPoint];
                        pointdata.passEndpoint(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                        st.liquidity = liquidityAddDelta(st.liquidity, - pointdata.liquidDelta);
                        st.currentPoint = st.currentPoint - 1;
                        st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currentPoint);
                        st.allX = false;
                        st.currX = 0;
                        st.currY = MulDivMath.mulDivFloor(st.liquidity, st.sqrtPrice_96, TwoPower.Pow96);
                    }
                } else {
                    cache.finished = true;
                }
            }
            if (cache.finished || st.currentPoint < lowPt) {
                break;
            }
            int24 nextPt= pointBitmap.nearestLeftOneOrBoundary(searchStart, cache.pd);
            if (nextPt < lowPt) {
                nextPt = lowPt;
            }
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            
            // in [st.currentPoint, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [nextPt, st.currentPoint]
                st.currentPoint = nextPt;
                st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currentPoint);
                st.allX = true;
                cache.currVal = nextVal;
            } else {
                // amount > 0
                uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
                if (amountNoFee > 0) {
                    SwapMathX2Y.RangeRetState memory retState = SwapMathX2Y.x2YRange(
                        st, nextPt, cache._sqrtRate_96, amountNoFee
                    );
                    cache.finished = retState.finished;
                    uint128 feeAmount;
                    if (retState.costX >= amountNoFee) {
                        feeAmount = amount - retState.costX;
                    } else {
                        feeAmount = uint128(uint256(retState.costX) * fee / 1e6);
                        uint256 mod = uint256(retState.costX) * fee % 1e6;
                        if (mod > 0) {
                            feeAmount += 1;
                        }
                    }
                    amountY += retState.acquireY;
                    amountX = amountX + retState.costX + feeAmount;
                    amount -= (retState.costX + feeAmount);
                    
                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + MulDivMath.mulDivFloor(feeAmount, TwoPower.Pow128, st.liquidity);
                    st.currentPoint = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                } else {
                    cache.finished = true;
                }
                if (st.currentPoint == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
            if (st.currentPoint <= lowPt) {
                break;
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

        // write back fee scale, no fee of y
        feeScaleX_128 = cache.currFeeScaleX_128;
        // write back state
        state = st;
        // transfer y to trader
        if (amountY > 0) {
            TokenTransfer.transferToken(tokenY, recipient, amountY);
            // trader pay x
            require(amountX > 0, "PP");
            uint256 bx = balanceX();
            IiZiSwapCallback(msg.sender).swapX2YCallback(amountX, amountY, data);
            require(balanceX() >= bx + amountX, "XE");
        }
        
    }
    
    function swapX2YDesireY(
        address recipient,
        uint128 desireY,
        int24 lowPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY) {
        // todo we will consider -amount of desired y later
        require(desireY > 0, "AP");
        require(lowPt >= leftMostPt, "LO");
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = pointDelta;
        cache.currVal = getStatusVal(st.currentPoint, cache.pd);
        cache.startPoint = st.currentPoint;
        cache.startLiquidity = st.liquidity;
        cache.timestamp = uint32(block.number);
        while (lowPt <= st.currentPoint && !cache.finished) {
            // clear limit order first
            if (cache.currVal & 2 > 0) {
                LimitOrder.Data storage od = limitOrderData[st.currentPoint];
                uint256 currY = od.sellingY;
                (uint256 costX, uint256 acquireY) = SwapMathX2YDesire.x2YAtPrice(
                    desireY, st.sqrtPrice_96, currY
                );
                if (acquireY >= desireY) {
                    cache.finished = true;
                }
                desireY = (desireY <= acquireY) ? 0 : desireY - uint128(acquireY);
                amountX += costX;
                amountY += acquireY;
                currY -= acquireY;
                od.sellingY = currY;
                od.earnX += costX;
                od.accEarnX += costX;
                if (od.sellingX == 0 && currY == 0) {
                    int24 newVal = cache.currVal & 1;
                    setStatusVal(st.currentPoint, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currentPoint, cache.pd);
                    }
                }
            }
            if (cache.finished) {
                break;
            }
            int24 searchStart = st.currentPoint - 1;
            // second, clear the liquid if the currentPoint is an endpoint
            if (cache.currVal & 1 > 0) {
                if (st.liquidity > 0) {
                    SwapMathX2YDesire.RangeRetState memory retState = SwapMathX2YDesire.x2YRange(
                        st,
                        st.currentPoint,
                        cache._sqrtRate_96,
                        desireY
                    );
                    cache.finished = retState.finished;
                    
                    uint256 feeAmount = MulDivMath.mulDivCeil(retState.costX, fee, 1e6);

                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + MulDivMath.mulDivFloor(feeAmount, TwoPower.Pow128, st.liquidity);
                    amountX += (retState.costX + feeAmount);
                    amountY += retState.acquireY;
                    desireY = (desireY <= retState.acquireY) ? 0 : desireY - uint128(retState.acquireY);
                    st.currentPoint = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                }
                if (!cache.finished) {
                    Point.Data storage pointdata = points[st.currentPoint];
                    pointdata.passEndpoint(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    st.liquidity = liquidityAddDelta(st.liquidity, - pointdata.liquidDelta);
                    st.currentPoint = st.currentPoint - 1;
                    st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currentPoint);
                    st.allX = false;
                    st.currX = 0;
                    st.currY = MulDivMath.mulDivFloor(st.liquidity, st.sqrtPrice_96, TwoPower.Pow96);
                }
            }
            if (cache.finished || st.currentPoint < lowPt) {
                break;
            }
            int24 nextPt = pointBitmap.nearestLeftOneOrBoundary(searchStart, cache.pd);
            if (nextPt < lowPt) {
                nextPt = lowPt;
            }
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            // in [st.currentPoint, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [nextPt, st.currentPoint]
                st.currentPoint = nextPt;
                st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currentPoint);
                st.allX = true;
                cache.currVal = nextVal;
            } else {
                // amount > 0
                // if (desireY > 0) {
                    SwapMathX2YDesire.RangeRetState memory retState = SwapMathX2YDesire.x2YRange(
                        st, nextPt, cache._sqrtRate_96, desireY
                    );
                    cache.finished = retState.finished;
                    
                    uint256 feeAmount = MulDivMath.mulDivCeil(retState.costX, fee, 1e6);

                    amountY += retState.acquireY;
                    amountX += (retState.costX + feeAmount);
                    desireY = (desireY <= retState.acquireY) ? 0 : desireY - uint128(retState.acquireY);
                    
                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + MulDivMath.mulDivFloor(feeAmount, TwoPower.Pow128, st.liquidity);

                    st.currentPoint = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                // } else {
                //     cache.finished = true;
                // }
                if (st.currentPoint == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
            if (st.currentPoint <= lowPt) {
                break;
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

        // write back fee scale, no fee of y
        feeScaleX_128 = cache.currFeeScaleX_128;
        // write back state
        state = st;
        // transfer y to trader
        if (amountY > 0) {
            TokenTransfer.transferToken(tokenY, recipient, amountY);
            // trader pay x
            require(amountX > 0, "PP");
            uint256 bx = balanceX();
            IiZiSwapCallback(msg.sender).swapX2YCallback(amountX, amountY, data);
            require(balanceX() >= bx + amountX, "XE");
        }
    }
}