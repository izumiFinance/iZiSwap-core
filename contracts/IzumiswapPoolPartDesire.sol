pragma solidity ^0.8.4;

import './interfaces/IIzumiswapPool.sol';
import './libraries/Liquidity.sol';
import './libraries/Point.sol';
import './libraries/PointBitmap.sol';
import './libraries/LogPowMath.sol';
import './libraries/MulDivMath.sol';
import './libraries/TwoPower.sol';
import './libraries/PointOrder.sol';
import './libraries/SwapMathY2X.sol';
import './libraries/SwapMathX2Y.sol';
import './libraries/SwapMathY2XDesire.sol';
import './libraries/SwapMathX2YDesire.sol';
import './libraries/UserEarn.sol';
import './libraries/TokenTransfer.sol';
import './libraries/State.sol';
import './interfaces/IIzumiswapCallback.sol';
import 'hardhat/console.sol';

contract IzumiswapPoolPartDesire {

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
    
    address private original;

    address private poolPart;
    address private poolPartDesire;

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


    function swapY2XDesireX(
        address recipient,
        uint128 desireX,
        int24 highPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY) {
        
        require (desireX > 0, "XP");
        require (highPt <= rightMostPt, "HO");
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
                (uint256 costY, uint128 acquireX) = SwapMathY2XDesire.y2XAtPrice(
                    desireX, st.sqrtPrice_96, currX
                );
                if (acquireX >= desireX) {
                    cache.finished = true;
                }
                desireX = (desireX <= acquireX) ? 0 : desireX - acquireX;
                amountY += costY;
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
            int24 nextPt = pointBitmap.nearestRightOneOrBoundary(st.currPt, cache.pd);
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            if (nextPt > highPt) {
                nextVal = 0;
                nextPt = highPt;
            }
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {
                // no liquidity in the range [st.currPoint, nextPt)
                st.currPt = nextPt;
                st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currPt);
                st.allX = true;
                if (nextVal & 1 > 0) {
                    Point.Data storage endPt = points[nextPt];
                    // pass next point from left to right
                    endPt.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    // we should add delta liquid of nextPt
                    int128 liquidDelta = endPt.liquidDelta;
                    st.liquidity = liquidityAddDelta(st.liquidity, liquidDelta);
                }
                cache.currVal = nextVal;
            } else {
                // desireX > 0
                if (desireX > 0) {
                    SwapMathY2XDesire.RangeRetState memory retState = SwapMathY2XDesire.y2XRange(
                        st, nextPt, cache._sqrtRate_96, desireX
                    );
                    cache.finished = retState.finished;
                    uint256 feeAmount = MulDivMath.mulDivCeil(retState.costY, fee, 1e6);

                    amountX += retState.acquireX;
                    amountY += (retState.costY + feeAmount);
                    desireX = (desireX <= retState.acquireX) ? 0 : desireX - uint128(retState.acquireX);
                    
                    cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + MulDivMath.mulDivFloor(feeAmount, TwoPower.Pow128, st.liquidity);

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
                    st.liquidity = liquidityAddDelta(st.liquidity, endPt.liquidDelta);
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
            TokenTransfer.transferToken(tokenX, recipient, amountX);
            // trader pay y
            require(amountY > 0, "PP");
            uint256 by = balanceY();
            IIzumiswapSwapCallback(msg.sender).swapY2XCallback(amountX, amountY, data);
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
        cache.pd = ptDelta;
        cache.currVal = getStatusVal(st.currPt, cache.pd);
        while (lowPt <= st.currPt && !cache.finished) {
            // clear limit order first
            if (cache.currVal & 2 > 0) {
                PointOrder.Data storage od = limitOrderData[st.currPt];
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
                if (st.liquidity > 0) {
                    SwapMathX2YDesire.RangeRetState memory retState = SwapMathX2YDesire.x2YRange(
                        st,
                        st.currPt,
                        cache._sqrtRate_96,
                        desireY
                    );
                    cache.finished = retState.finished;
                    
                    uint256 feeAmount = MulDivMath.mulDivCeil(retState.costX, fee, 1e6);

                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + MulDivMath.mulDivFloor(feeAmount, TwoPower.Pow128, st.liquidity);
                    amountX += (retState.costX + feeAmount);
                    amountY += retState.acquireY;
                    desireY = (desireY <= retState.acquireY) ? 0 : desireY - uint128(retState.acquireY);
                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                }
                if (!cache.finished) {
                    Point.Data storage ptdata = points[st.currPt];
                    ptdata.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    st.liquidity = liquidityAddDelta(st.liquidity, - ptdata.liquidDelta);
                    st.currPt = st.currPt - 1;
                    st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currPt);
                    st.allX = false;
                    st.currX = 0;
                    st.currY = MulDivMath.mulDivFloor(st.liquidity, st.sqrtPrice_96, TwoPower.Pow96);
                }
            }
            if (cache.finished || st.currPt < lowPt) {
                break;
            }
            int24 nextPt = pointBitmap.nearestLeftOneOrBoundary(searchStart, cache.pd);
            if (nextPt < lowPt) {
                nextPt = lowPt;
            }
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [nextPt, st.currPt]
                st.currPt = nextPt;
                st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currPt);
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

                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                // } else {
                //     cache.finished = true;
                // }
                if (st.currPt == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
            if (st.currPt <= lowPt) {
                break;
            }
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
            IIzumiswapSwapCallback(msg.sender).swapX2YCallback(amountX, amountY, data);
            require(balanceX() >= bx + amountX, "XE");
        }
    }
}