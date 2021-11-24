// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './MulDivMath.sol';
import './TwoPower.sol';
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
    function y2XAtPrice(
        uint128 desireX,
        uint160 sqrtPrice_96,
        uint256 currX
    ) internal pure returns (uint256 costY, uint128 acquireX) {
        acquireX = desireX;
        if (acquireX > currX) {
            acquireX = uint128(currX);
        }
        uint256 l = MulDivMath.mulDivCeil(acquireX, sqrtPrice_96, TwoPower.Pow96);
        costY = MulDivMath.mulDivCeil(l, sqrtPrice_96, TwoPower.Pow96);
    }
    function y2XAtPriceLiquidity(
        uint128 desireX,
        uint160 sqrtPrice_96,
        uint256 currX,
        uint256 currY,
        uint128 liquidity
    ) internal view returns (uint256 costY, uint128 acquireX) {
        uint256 currYLim = MulDivMath.mulDivCeil(liquidity, sqrtPrice_96, TwoPower.Pow96);
        uint256 deltaY = (currYLim >= currY) ? currYLim - currY : 0;
        if (desireX >= currX) {
            acquireX = uint128(currX);
            costY = deltaY;
        } else {
            acquireX = desireX;
            costY = MulDivMath.mulDivCeil(acquireX, deltaY, currX);
        }
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
        uint256 sqrtPriceLM1 = MulDivMath.mulDivCeil(rg.sqrtPriceL_96, TwoPower.Pow96, rg.sqrtRate_96);
        uint256 dcl = MulDivMath.mulDivFloor(desireX, rg.sqrtPriceL_96, rg.liquidity);
        uint256 dclm1 = MulDivMath.mulDivCeil(desireX, sqrtPriceLM1, rg.liquidity);
        // dcl, dclm1 <= desireX * sqrtPriceL_96 / liquidity
        //            <= liquidity * 2^24 * Q96 / sqrtPriceL_96 * sqrtPriceL_96 / liquidity
        //            <= 2^120
        uint256 div = TwoPower.Pow96 + dclm1;
        if (div <= dcl) {
            // too small, imposible
            ret.acquireX = maxX;
            ret.costY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        div -= dcl;
        // sqrtPriceL_96 * Q96 < 2^256, because sqrtPriceL_96 is uint160
        uint256 sqrtPriceLoc_96 = rg.sqrtPriceL_96 * TwoPower.Pow96 / div;
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
        ret.locPt = LogPowMath.getLogSqrtPriceFloor(uint160(sqrtPriceLoc_96));
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
        ret.sqrtLoc_96 = LogPowMath.getSqrtPrice(ret.locPt);
        ret.completeLiquidity = false;
        ret.acquireX = AmountMath.getAmountX(
            rg.liquidity,
            rg.leftPt,
            ret.locPt,
            ret.sqrtLoc_96,
            rg.sqrtRate_96,
            false
        );
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
                st.sqrtPrice_96 = uint160(MulDivMath.mulDivFloor(st.sqrtPrice_96, sqrtRate_96, TwoPower.Pow96));
            } else {
                (retState.costY, retState.acquireX) = y2XAtPriceLiquidity(desireX, st.sqrtPrice_96, st.currX, st.currY, st.liquidity);
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
                        retState.sqrtFinalPrice_96 = LogPowMath.getSqrtPrice(retState.finalPt);
                        retState.finalAllX = true;
                    } else {
                        // not finished
                        st.currPt += 1;
                        desireX -= uint128(retState.acquireX);
                        st.sqrtPrice_96 = LogPowMath.getSqrtPrice(st.currPt);
                    }
                }
            }
        }
        if (retState.finished) {
            return retState;
        }
        if (st.currPt < rightPt) {
            uint160 sqrtPriceR_96 = LogPowMath.getSqrtPrice(rightPt);
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
            retState.costY += ret.costY;
            retState.acquireX += ret.acquireX;
            desireX = (desireX <= ret.acquireX) ? 0 : desireX - uint128(ret.acquireX);
            if (ret.completeLiquidity) {
                retState.finished = (desireX == 0);
                retState.finalPt = rightPt;
                retState.sqrtFinalPrice_96 = sqrtPriceR_96;
                retState.finalAllX = true;
            } else {
                uint256 locCurrX = uint256(st.liquidity) * TwoPower.Pow96 / ret.sqrtLoc_96;
                (uint256 locCostY, uint128 locAcquireX) = y2XAtPriceLiquidity(desireX, ret.sqrtLoc_96, locCurrX, 0, st.liquidity);
                retState.costY += locCostY;
                retState.acquireX += locAcquireX;
                retState.finished = true;
                if (locAcquireX >= locCurrX) {
                    retState.finalPt = ret.locPt + 1;
                    retState.sqrtFinalPrice_96 = LogPowMath.getSqrtPrice(retState.finalPt);
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