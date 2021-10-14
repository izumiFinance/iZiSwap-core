pragma solidity ^0.8.4;

import './FullMath.sol';
import './FixedPoint96.sol';
import './AmountMath.sol';
import './State.sol';
import "hardhat/console.sol";

library SwapMathY2XDesire {
    struct RangeRetState {
        bool finished;
        uint256 costY;
        uint256 acquireX;
        int24 finalPt;
        uint160 sqrtFinalPrice_96;
        bool finalAllX;
        uint256 finalCurrX;
        uint256 finalCurrY;
    }
    function y2XAtPriceLiquidity(
        uint128 desireX,
        uint160 sqrtPrice_96,
        uint256 currX
    ) internal pure returns (uint256 costY, uint128 acquireX) {
        acquireX = desireX;
        if (acquireX > currX) {
            acquireX = uint128(currX);
        }
        uint256 l = FullMath.mulDivRoundingUp(acquireX, sqrtPrice_96, FixedPoint96.Q96);
        costY = FullMath.mulDivRoundingUp(l, sqrtPrice_96, FixedPoint96.Q96);
    }
    struct Range {
        uint128 liquidity;
        uint160 sqrtPriceL_96;
        int24 leftPt;
        uint160 sqrtPriceR_96;
        int24 rightPt;
        uint160 sqrtRate_96;
    }
    struct RangeCompRet {
        uint256 costY;
        uint256 acquireX;
        bool completeLiquidity;
        int24 locPt;
        uint160 sqrtLoc_96;
    }
    function y2XRangeComplete(
        Range memory rg,
        uint128 desireX
    ) internal view returns (
        RangeCompRet memory ret
    ) {
        uint256 maxX = AmountMath.getAmountX(rg.liquidity, rg.leftPt, rg.rightPt, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
        if (maxX <= desireX) {
            ret.acquireX = maxX;
            ret.costY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        // sqrtPriceL / rate
        uint256 sqrtPriceLM1 = FullMath.mulDivRoundingUp(rg.sqrtPriceL_96, FixedPoint96.Q96, rg.sqrtRate_96);
        uint256 dcl = FullMath.mulDiv(desireX, rg.sqrtPriceL_96, rg.liquidity);
        uint256 dclm1 = FullMath.mulDivRoundingUp(desireX, sqrtPriceLM1, rg.liquidity);
        // dcl, dclm1 <= desireX * sqrtPriceL_96 / liquidity
        //            <= liquidity * 2^24 * Q96 / sqrtPriceL_96 * sqrtPriceL_96 / liquidity
        //            <= 2^120
        int256 div = int256(FixedPoint96.Q96 + dclm1 - dcl);
        if (div <= 0) {
            // too small, imposible
            ret.acquireX = maxX;
            ret.costY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        // sqrtPriceL_96 * Q96 < 2^256, because sqrtPriceL_96 is uint160
        uint256 sqrtPriceLoc_96 = rg.sqrtPriceL_96 * FixedPoint96.Q96 / uint256(div);
        if (sqrtPriceLoc_96 >= rg.sqrtPriceR_96) {
            // also imposible
            ret.acquireX = maxX;
            ret.costY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        if (sqrtPriceLoc_96 <= rg.sqrtPriceL_96) {
            ret.locPt = rg.leftPt;
            ret.sqrtLoc_96 = rg.sqrtPriceL_96;
            ret.acquireX = 0;
            ret.costY = 0;
            ret.completeLiquidity = false;
            return ret;
        }
        ret.locPt = TickMath.getTickAtSqrtRatio(uint160(sqrtPriceLoc_96));
        console.log("rightpt: %s", uint256(int256(rg.rightPt)));
        console.log("locPt: %s", uint256(int256(ret.locPt)));
        if (ret.locPt >= rg.rightPt) {
            // also imposible
            ret.acquireX = maxX;
            ret.costY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        if (ret.locPt <= rg.leftPt) {
            ret.locPt = rg.leftPt;
            ret.sqrtLoc_96 = rg.sqrtPriceL_96;
            ret.acquireX = 0;
            ret.costY = 0;
            ret.completeLiquidity = false;
            return ret;
        }
        ret.sqrtLoc_96 = TickMath.getSqrtRatioAtTick(ret.locPt);
        ret.completeLiquidity = false;
        ret.acquireX = AmountMath.getAmountX(
            rg.liquidity,
            rg.leftPt,
            ret.locPt,
            ret.sqrtLoc_96,
            rg.sqrtRate_96,
            false
        );
        console.log("pl: %s", uint256(rg.sqrtPriceL_96));
        console.log("pl: %s", uint256(ret.sqrtLoc_96));
        if (ret.sqrtLoc_96 < rg.sqrtPriceL_96) {
            ret.sqrtLoc_96 = rg.sqrtPriceL_96;
        }
        ret.costY = AmountMath.getAmountY(
            rg.liquidity,
            rg.sqrtPriceL_96,
            ret.sqrtLoc_96,
            rg.sqrtRate_96,
            true
        );
    }
    function y2XRange(
        State memory st,
        int24 rightPt,
        uint160 sqrtRate_96,
        uint128 desireX
    ) internal view returns (
        RangeRetState memory retState
    ) {
        retState.costY = 0;
        retState.acquireX = 0;
        retState.finished = false;
        if (!st.allX) {
            if (st.currX == 0) {
                st.currPt += 1;
                st.sqrtPrice_96 = uint160(FullMath.mulDiv(st.sqrtPrice_96, sqrtRate_96, FixedPoint96.Q96));
                console.log("move right without swap, topt: %s", uint256(int256(st.currPt)));
            } else {
                (retState.costY, retState.acquireX) = y2XAtPriceLiquidity(desireX, st.sqrtPrice_96, st.currX);
                if (retState.acquireX < st.currX) {
                    // currX remain, means desire runout
                    retState.finished = true;
                    retState.finalAllX = false;
                    retState.finalCurrX = st.currX - retState.acquireX;
                    retState.finalCurrY = st.currY + retState.costY;
                    retState.finalPt = st.currPt;
                    retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
                } else {
                    if (retState.acquireX >= desireX) {
                        // currX not remain but desire runout
                        retState.finished = true;
                        retState.finalPt = st.currPt + 1;
                        retState.sqrtFinalPrice_96 = TickMath.getSqrtRatioAtTick(retState.finalPt);
                        retState.finalAllX = true;
                    } else {
                        // not finished
                        st.currPt += 1;
                        desireX -= uint128(retState.acquireX);
                        st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                    }
                }
            }
        }
        if (retState.finished) {
            return retState;
        }
        if (st.currPt < rightPt) {
            uint160 sqrtPriceR_96 = TickMath.getSqrtRatioAtTick(rightPt);
            RangeCompRet memory ret = y2XRangeComplete(
                Range({
                    liquidity: st.liquidity,
                    sqrtPriceL_96: st.sqrtPrice_96,
                    leftPt: st.currPt,
                    sqrtPriceR_96: sqrtPriceR_96,
                    rightPt: rightPt,
                    sqrtRate_96: sqrtRate_96
                }), 
                desireX
            );
            console.log("costY: %s", ret.costY);
            console.log("acquireX: %s", ret.acquireX);
            retState.costY += ret.costY;
            retState.acquireX += ret.acquireX;
            desireX = (desireX <= ret.acquireX) ? 0 : desireX - uint128(ret.acquireX);
            if (ret.completeLiquidity) {
                console.log("comp");
                retState.finished = (desireX == 0);
                retState.finalPt = rightPt;
                retState.sqrtFinalPrice_96 = sqrtPriceR_96;
                retState.finalAllX = true;
            } else {
                console.log("uncomp");
                uint256 locCurrX = st.liquidity * FixedPoint96.Q96 / ret.sqrtLoc_96;
                (uint256 locCostY, uint128 locAcquireX) = y2XAtPriceLiquidity(desireX, ret.sqrtLoc_96, locCurrX);
                retState.costY += locCostY;
                retState.acquireX += locAcquireX;
                retState.finished = true;
                if (locAcquireX >= locCurrX) {
                    retState.finalPt = ret.locPt + 1;
                    retState.sqrtFinalPrice_96 = TickMath.getSqrtRatioAtTick(retState.finalPt);
                    retState.finalAllX = true;
                } else {
                    retState.finalPt = ret.locPt;
                    retState.sqrtFinalPrice_96 = ret.sqrtLoc_96;
                    retState.finalAllX = false;
                    retState.finalCurrX = locCurrX - locAcquireX;
                    retState.finalCurrY = locCostY;
                }
            }
        } else {
            retState.finished = false;
            retState.finalPt = st.currPt;
            retState.finalAllX = true;
            retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
        }
    }
}