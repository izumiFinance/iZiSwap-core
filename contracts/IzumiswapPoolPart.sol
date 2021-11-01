pragma solidity ^0.8.4;

import './interfaces/IIzumiswapPool.sol';
import './libraries/Liquidity.sol';
import './libraries/Point.sol';
import './libraries/PointBitmap.sol';
import './libraries/TickMath.sol';
import './libraries/FullMath.sol';
import './libraries/FixedPoint96.sol';
import './libraries/PointOrder.sol';
import './libraries/SwapMathY2X.sol';
import './libraries/SwapMathX2Y.sol';
import './libraries/SwapMathY2XDesire.sol';
import './libraries/SwapMathX2YDesire.sol';
import './libraries/UserEarn.sol';
import './libraries/TransferHelper.sol';
import './libraries/State.sol';
import './interfaces/IIzumiswapCallback.sol';

contract IzumiswapPoolPart {

    // TODO following usings may need modify
    using Liquidity for mapping(bytes32 =>Liquidity.Data);
    using Liquidity for Liquidity.Data;
    using Point for mapping(int24 =>Point.Data);
    using Point for Point.Data;
    using PointBitmap for mapping(int16 =>uint256);
    using PointOrder for PointOrder.Data;
    using UserEarn for UserEarn.Data;
    using UserEarn for mapping(bytes32 =>UserEarn.Data);
    using SwapMathY2X for SwapMathY2X.RangeRetState;
    using SwapMathX2Y for SwapMathX2Y.RangeRetState;

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
    int24 public ptDelta;

    uint256 public feeScaleX_128;
    uint256 public feeScaleY_128;

    uint160 public sqrtRate_96;

    // struct State {
    //     uint160 sqrtPrice_96;
    //     int24 currPt;
    //     uint256 currX;
    //     uint256 currY;
    //     // liquidity from currPt to right
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
    }
    struct WithdrawRet {
        uint256 x;
        uint256 y;
        uint256 xc;
        uint256 yc;
        uint256 currX;
        uint256 currY;
    }

    /// TODO: following mappings may need modify
    mapping(bytes32 =>Liquidity.Data) public liquidities;
    mapping(int16 =>uint256) pointBitmap;
    mapping(int24 =>Point.Data) points;
    mapping(int24 =>int24) public statusVal;
    mapping(int24 =>PointOrder.Data) public limitOrderData;
    mapping(bytes32 => UserEarn.Data) userEarnX;
    mapping(bytes32 => UserEarn.Data) userEarnY;
    address private  original;

    address private poolPart;
    address private poolPartDesire;
    // address private immutable original;

    function assignLimOrderEarnY(
        int24 pt,
        uint256 assignY
    ) external returns (uint256 actualAssignY) {
        actualAssignY = assignY;
        UserEarn.Data storage ue = userEarnY.get(msg.sender, pt);
        if (actualAssignY > ue.earn) {
            actualAssignY = ue.earn;
        }
        ue.earn -= actualAssignY;
        ue.earnAssign += actualAssignY;
    }
    function assignLimOrderEarnX(
        int24 pt,
        uint256 assignX
    ) external returns (uint256 actualAssignX) {
        actualAssignX = assignX;
        UserEarn.Data storage ue = userEarnX.get(msg.sender, pt);
        if (actualAssignX > ue.earn) {
            actualAssignX = ue.earn;
        }
        ue.earn -= actualAssignX;
        ue.earnAssign += actualAssignX;
    }
    function decLimOrderWithX(
        int24 pt,
        uint128 deltaX
    ) external returns (uint128 actualDeltaX) {
        
        require(pt % ptDelta == 0, "PD");
        require(pt >= state.currPt, "PG");

        UserEarn.Data storage ue = userEarnY.get(msg.sender, pt);
        PointOrder.Data storage pointOrder = limitOrderData[pt];
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        (actualDeltaX, pointOrder.earnY) = ue.dec(deltaX, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnY, true);
        pointOrder.sellingX -= actualDeltaX;
        
        if (actualDeltaX > 0 && pointOrder.sellingX == 0) {
            int24 newVal = getStatusVal(pt, ptDelta) & 1;
            setStatusVal(pt, ptDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(pt, ptDelta);
            }
        }
        
    }


    function decLimOrderWithY(
        int24 pt,
        uint128 deltaY
    ) external returns (uint128 actualDeltaY) {
        
        require(pt % ptDelta == 0, "PD");
        require(pt <= state.currPt, "PL");

        UserEarn.Data storage ue = userEarnX.get(msg.sender, pt);
        PointOrder.Data storage pointOrder = limitOrderData[pt];
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        (actualDeltaY, pointOrder.earnX) = ue.dec(deltaY, pointOrder.accEarnX, sqrtPrice_96, pointOrder.earnX, false);

        pointOrder.sellingY -= actualDeltaY;
        
        if (actualDeltaY > 0 && pointOrder.sellingY == 0) {
            int24 newVal = getStatusVal(pt, ptDelta) & 1;
            setStatusVal(pt, ptDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(pt, ptDelta);
            }
        }
        
    }


    function addLimOrderWithX(
        address recipient,
        int24 pt,
        uint128 amountX,
        bytes calldata data
    ) external returns (uint128 orderX, uint256 acquireY) {
        
        require(pt % ptDelta == 0, "PD");
        require(pt >= state.currPt, "PG");
        require(amountX > 0, "XP");

        
        // update point order
        PointOrder.Data storage pointOrder = limitOrderData[pt];

        orderX = amountX;
        acquireY = 0;
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        
        uint256 currY = pointOrder.sellingY;
        uint256 currX = pointOrder.sellingX;
        if (currY > 0) {
            uint128 costX;
            (costX, acquireY) = SwapMathX2Y.x2YAtPrice(amountX, sqrtPrice_96, currY);
            orderX -= costX;
            currY -= acquireY;
            pointOrder.accEarnX = pointOrder.accEarnX + costX;
            pointOrder.earnX = pointOrder.earnX + costX;
            pointOrder.sellingY = currY;
        }
        if (orderX > 0) {
            currX += orderX;
            pointOrder.sellingX = currX;
        }

        UserEarn.Data storage ue = userEarnY.get(recipient, pt);
        pointOrder.earnY = ue.add(orderX, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnY, true);
        ue.earnAssign = ue.earnAssign + acquireY;
        
        // update statusval and bitmap
        if (currX == 0 && currY == 0) {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                setStatusVal(pt, ptDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(pt, ptDelta);
                }
            }
        } else {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                setStatusVal(pt, ptDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(pt, ptDelta);
                }
            }
        }

        // trader pay x
        uint256 bx = balanceX();
        IIzumiswapAddLimOrderCallback(msg.sender).payCallback(amountX, 0, data);
        require(balanceX() >= bx + amountX, "XE");
        
    }
    
    function addLimOrderWithY(
        address recipient,
        int24 pt,
        uint128 amountY,
        bytes calldata data
    ) external returns (uint128 orderY, uint256 acquireX) {
        
        require(pt % ptDelta == 0, "PD");
        require(pt <= state.currPt, "PL");
        require(amountY > 0, "YP");

        // update point order
        PointOrder.Data storage pointOrder = limitOrderData[pt];

        orderY = amountY;
        acquireX = 0;
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        uint256 currY = pointOrder.sellingY;
        uint256 currX = pointOrder.sellingX;
        if (currX > 0) {
            uint128 costY;
            (costY, acquireX) = SwapMathY2X.y2XAtPrice(amountY, sqrtPrice_96, currX);
            orderY -= costY;
            currX -= acquireX;
            pointOrder.accEarnY = pointOrder.accEarnY + costY;
            pointOrder.earnY = pointOrder.earnY + costY;
            pointOrder.sellingX = currX;
        }
        if (orderY > 0) {
            currY += orderY;
            pointOrder.sellingY = currY;
        }
        UserEarn.Data storage ue = userEarnX.get(recipient, pt);
        pointOrder.earnX = ue.add(orderY, pointOrder.accEarnX, sqrtPrice_96, pointOrder.earnX, false);
        ue.earnAssign = ue.earnAssign + acquireX;

        // update statusval and bitmap
        if (currX == 0 && currY == 0) {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                setStatusVal(pt, ptDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(pt, ptDelta);
                }
            }
        } else {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                setStatusVal(pt, ptDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(pt, ptDelta);
                }
            }
        }

        // trader pay y
        uint256 by = balanceY();
        IIzumiswapAddLimOrderCallback(msg.sender).payCallback(0, amountY, data);
        require(balanceY() >= by + amountY, "YE");
        
    }

    function collectLimOrder(
        address recipient, int24 pt, uint256 collectDec, uint256 collectEarn, bool isEarnY
    ) external returns(uint256 actualCollectDec, uint256 actualCollectEarn) {
        UserEarn.Data storage ue = isEarnY? userEarnY.get(msg.sender, pt) : userEarnX.get(msg.sender, pt);
        actualCollectDec = collectDec;
        if (actualCollectDec > ue.sellingDec) {
            actualCollectDec = ue.sellingDec;
        }
        actualCollectEarn = collectEarn;
        if (actualCollectEarn > ue.earn) {
            actualCollectEarn = ue.earn;
        }
        (uint256 x, uint256 y) = isEarnY? (actualCollectDec, actualCollectEarn): (actualCollectEarn, actualCollectDec);
        if (x > 0) {
            TransferHelper.safeTransfer(tokenX, recipient, x);
        }
        if (y > 0) {
            TransferHelper.safeTransfer(tokenY, recipient, y);
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

    /// @dev swap pay tokeny and buy token x
    /// @param recipient address of actual trader
    /// @param amount amount of y to pay from trader
    /// @param highPt point of highest price of x
    /// @param data calldata for user's callback to transfer y
    /// @return amountX amountY token x trader actually acquired and token y trader actually paid
    function swapY2X(
        address recipient,
        uint128 amount,
        int24 highPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY) {
        
        // todo we will consider -amount of desired x later
        require(amount > 0, "AP");
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = ptDelta;
        cache.currVal = getStatusVal(st.currPt, cache.pd);
        while (st.currPt < highPt && !cache.finished) {

            if (cache.currVal & 2 > 0) {
                // clear limit order first
                PointOrder.Data storage od = limitOrderData[st.currPt];
                uint256 currX = od.sellingX;
                (uint128 costY, uint256 acquireX) = SwapMathY2X.y2XAtPrice(
                    amount, st.sqrtPrice_96, currX
                );
                if (acquireX < currX || costY >= amount) {
                    cache.finished = true;
                }
                amount -= costY;
                amountY = amountY + costY;
                amountX += acquireX;
                currX -= acquireX;
                od.sellingX = currX;
                od.earnY += costY;
                od.accEarnY += costY;
                if (od.sellingY == 0 && currX == 0) {
                    int24 newVal = cache.currVal & 1;
                    setStatusVal(st.currPt, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currPt, cache.pd);
                    }
                }
            }

            if (cache.finished) {
                break;
            }

            (int24 nextPt, bool inited) = pointBitmap.nextInitializedpointWithinOneWord(st.currPt, cache.pd, false);
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            if (nextPt > highPt) {
                nextVal = 0;
                nextPt = highPt;
            }
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [st.currPoint, nextPt)
                st.currPt = nextPt;
                st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                st.allX = true;
                if (nextVal & 1 > 0) {
                    Point.Data storage endPt = points[nextPt];
                    // pass next point from left to right
                    endPt.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    // we should add delta liquid of nextPt
                    int128 liquidDelta = endPt.liquidDelta;
                    st.liquidity = LiquidityMath.addDelta(st.liquidity, liquidDelta);
                }
                cache.currVal = nextVal;
            } else {
                // amount > 0
                uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
                if (amountNoFee > 0) {
                    SwapMathY2X.RangeRetState memory retState = SwapMathY2X.y2XRange(
                        st, nextPt, cache._sqrtRate_96, amountNoFee
                    );
                    cache.finished = retState.finished;
                    uint128 feeAmount;
                    if (retState.costY >= amountNoFee) {
                        feeAmount = amount - retState.costY;
                    } else {
                        feeAmount = uint128(uint256(retState.costY) * fee / 1e6);
                        uint256 mod = uint256(retState.costY) * fee % 1e6;
                        if (mod > 0) {
                            feeAmount += 1;
                        }
                    }

                    amountX += retState.acquireX;
                    amountY = amountY + retState.costY + feeAmount;
                    amount -= (retState.costY + feeAmount);
                    
                    cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                } else {
                    cache.finished = true;
                }
                if (st.currPt == nextPt && (nextVal & 1) > 0) {
                    Point.Data storage endPt = points[nextPt];
                    // pass next point from left to right
                    endPt.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    st.liquidity = LiquidityMath.addDelta(st.liquidity, endPt.liquidDelta);
                }
                if (st.currPt == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
        }
        // write back fee scale, no fee of x
        feeScaleY_128 = cache.currFeeScaleY_128;
        // write back state
        state = st;
        // transfer x to trader
        if (amountX > 0) {
            TransferHelper.safeTransfer(tokenX, recipient, amountX);
            // trader pay y
            require(amountY > 0, "PP");
            uint256 by = balanceY();
            IIzumiswapSwapCallback(msg.sender).swapY2XCallback(amountY, data);
            require(balanceY() >= by + amountY, "YE");
        }
        
    }

    function getStatusVal(int24 pt, int24 pd) internal view returns(int24 val) {
        if (pt % pd != 0) {
            return 0;
        }
        val = statusVal[pt / pd];
    }
    function setStatusVal(int24 pt, int24 pd, int24 val) internal {
        statusVal[pt / pd] = val;
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
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = ptDelta;
        cache.currVal = getStatusVal(st.currPt, cache.pd);
        while (lowPt <= st.currPt && !cache.finished) {
            // clear limit order first
            if (cache.currVal & 2 > 0) {
                PointOrder.Data storage od = limitOrderData[st.currPt];
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
                    setStatusVal(st.currPt, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currPt, cache.pd);
                    }
                }
            }
            if (cache.finished) {
                break;
            }
            int24 searchStart = st.currPt - 1;
            // second, clear the liquid if the currPt is an endpt
            if (cache.currVal & 1 > 0) {
                uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
                if (amountNoFee > 0) {
                    if (st.liquidity > 0) {
                        SwapMathX2Y.RangeRetState memory retState = SwapMathX2Y.x2YRange(
                            st,
                            st.currPt,
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
                        cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);
                        amountX = amountX + retState.costX + feeAmount;
                        amountY += retState.acquireY;
                        amount -= (retState.costX + feeAmount);
                        st.currPt = retState.finalPt;
                        st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                        st.allX = retState.finalAllX;
                        st.currX = retState.finalCurrX;
                        st.currY = retState.finalCurrY;
                    }
                    if (!cache.finished) {
                        Point.Data storage ptdata = points[st.currPt];
                        ptdata.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                        st.liquidity = LiquidityMath.addDelta(st.liquidity, - ptdata.liquidDelta);
                        st.currPt = st.currPt - 1;
                        st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                        st.allX = false;
                        st.currX = 0;
                        st.currY = FullMath.mulDiv(st.liquidity, st.sqrtPrice_96, FixedPoint96.Q96);
                    }
                } else {
                    cache.finished = true;
                }
            }
            if (cache.finished || st.currPt < lowPt) {
                break;
            }
            (int24 nextPt, bool inited) = pointBitmap.nextInitializedpointWithinOneWord(searchStart, cache.pd, true);
            if (nextPt < lowPt) {
                nextPt = lowPt;
            }
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [nextPt, st.currPt]
                st.currPt = nextPt;
                st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
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
                    
                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                } else {
                    cache.finished = true;
                }
                if (st.currPt == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
        }

        // write back fee scale, no fee of y
        feeScaleX_128 = cache.currFeeScaleX_128;
        // write back state
        state = st;
        // transfer y to trader
        if (amountY > 0) {
            TransferHelper.safeTransfer(tokenY, recipient, amountY);
            // trader pay x
            require(amountX > 0, "PP");
            uint256 bx = balanceX();
            IIzumiswapSwapCallback(msg.sender).swapX2YCallback(amountX, data);
            require(balanceX() >= bx + amountX, "XE");
        }
        
    }

    function findLeft(int24 searchStart, int24 pd) private view returns (int24 nextPt) {
        bool inited;
        ( nextPt,  inited) = pointBitmap.nextInitializedpointWithinOneWord(searchStart, pd, true);
    }
    
}