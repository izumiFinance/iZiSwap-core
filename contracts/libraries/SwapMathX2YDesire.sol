// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './MulDivMath.sol';
import './TwoPower.sol';
import './AmountMath.sol';
import './State.sol';
import "hardhat/console.sol";

library SwapMathX2YDesire {
    
    struct RangeRetState {
        bool finished;
        uint256 costX;
        uint256 acquireY;
        int24 finalPt;
        uint160 sqrtFinalPrice_96;
        bool finalAllX;
        uint256 finalCurrX;
        uint256 finalCurrY;
    }
    function x2YAtPrice(
        uint128 desireY,
        uint160 sqrtPrice_96,
        uint256 currY
    ) internal pure returns (uint256 costX, uint256 acquireY) {
        acquireY = desireY;
        if (acquireY > currY) {
            acquireY = currY;
        }
        uint256 l = MulDivMath.mulDivCeil(acquireY, TwoPower.Pow96, sqrtPrice_96);
        costX = MulDivMath.mulDivCeil(l, TwoPower.Pow96, sqrtPrice_96);
    }
    function x2YAtPriceLiquidity(
        uint128 desireY,
        uint160 sqrtPrice_96,
        uint256 currY,
        uint256 currX,
        uint128 liquidity
    ) internal view returns (uint256 costX, uint128 acquireY) {
        uint256 currXLim = MulDivMath.mulDivCeil(liquidity, TwoPower.Pow96, sqrtPrice_96);
        uint256 deltaX = (currXLim > currX) ? currXLim - currX : 0;
        if (desireY >= currY) {
            costX = deltaX;
            acquireY = uint128(currY);
        } else {
            acquireY = desireY;
            costX = MulDivMath.mulDivCeil(acquireY, deltaX, currY);
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
        uint256 costX;
        uint256 acquireY;
        bool completeLiquidity;
        int24 locPt;
        uint160 sqrtLoc_96;
    }
    function x2YRangeComplete(
        Range memory rg,
        uint128 desireY
    ) internal pure returns (
        RangeCompRet memory ret
    ) {
        uint256 maxY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
        if (maxY <= desireY) {
            ret.acquireY = maxY;
            ret.costX = AmountMath.getAmountX(rg.liquidity, rg.leftPt, rg.rightPt, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        uint256 cl = uint256(rg.sqrtPriceR_96);
        uint256 sub1 = uint256(desireY) * (rg.sqrtRate_96 - TwoPower.Pow96) / rg.liquidity;
        assembly {
            cl := sub(cl, sub1)
        }
        if (cl > rg.sqrtPriceR_96 || cl <= rg.sqrtPriceL_96) {
            // imposible, this means cl < 0 or too small and l <=rg.leftPt
            ret.acquireY = maxY;
            ret.costX = AmountMath.getAmountX(rg.liquidity, rg.leftPt, rg.rightPt, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        ret.locPt = LogPowMath.getLogSqrtPriceFloor(uint160(cl)) + 1;
        if (ret.locPt <= rg.leftPt) {
            // imposible, this means cl < 0 or too small and l <=rg.leftPt
            ret.acquireY = maxY;
            ret.costX = AmountMath.getAmountX(rg.liquidity, rg.leftPt, rg.rightPt, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        if (ret.locPt >= rg.rightPt) {
            ret.acquireY = 0;
            ret.costX = 0;
            ret.completeLiquidity = false;
            ret.locPt = rg.rightPt;
            ret.sqrtLoc_96 = rg.sqrtPriceR_96;
            return ret;
        }
        ret.completeLiquidity = false;
        ret.sqrtLoc_96 = LogPowMath.getSqrtPrice(ret.locPt);
        ret.acquireY = AmountMath.getAmountY(rg.liquidity, ret.sqrtLoc_96, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
        ret.costX = AmountMath.getAmountX(rg.liquidity, ret.locPt, rg.rightPt, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
    }
    function x2YRange(
        State memory st,
        int24 leftPt,
        uint160 sqrtRate_96,
        uint128 desireY
    ) internal view returns (
        RangeRetState memory retState
    ) {
        retState.costX = 0;
        retState.acquireY = 0;
        retState.finished = false;
        if (!st.allX && (st.currX > 0 || leftPt == st.currPt)) {
            (retState.costX, retState.acquireY) = x2YAtPriceLiquidity(desireY, st.sqrtPrice_96, st.currY, st.currX, st.liquidity);
            if (retState.acquireY < st.currY) {
                retState.finished = true;
                retState.finalAllX = false;
                retState.finalCurrY = st.currY - retState.acquireY;
                retState.finalCurrX = st.currX + retState.costX;
                retState.finalPt = st.currPt;
                retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
            } else {
                if (retState.acquireY >= desireY) {
                    retState.finished = true;
                    retState.finalPt = st.currPt;
                    retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
                    retState.finalAllX = true;
                } else {
                    desireY -= uint128(retState.acquireY);
                }
            }
        } else if (!st.allX) { // all y
            st.currPt = st.currPt + 1;
            st.sqrtPrice_96 = uint160(MulDivMath.mulDivFloor(st.sqrtPrice_96, sqrtRate_96, TwoPower.Pow96));
        }
        if (retState.finished) {
            return retState;
        }
        if (leftPt < st.currPt) {
            uint160 sqrtPriceL_96 = LogPowMath.getSqrtPrice(leftPt);
            RangeCompRet memory ret = x2YRangeComplete(
                Range({
                    liquidity: st.liquidity,
                    sqrtPriceL_96: sqrtPriceL_96,
                    leftPt: leftPt,
                    sqrtPriceR_96: st.sqrtPrice_96,
                    rightPt: st.currPt,
                    sqrtRate_96: sqrtRate_96
                }), 
                desireY
            );
            
            retState.costX += ret.costX;
            desireY = (desireY <= ret.acquireY) ? 0 : desireY - uint128(ret.acquireY);
            retState.acquireY += ret.acquireY;
            if (ret.completeLiquidity) {
                retState.finished = (desireY == 0);
                retState.finalPt = leftPt;
                retState.sqrtFinalPrice_96 = sqrtPriceL_96;
                retState.finalAllX = true;
            } else {
                // locPt > leftPt
                ret.locPt = ret.locPt - 1;
                ret.sqrtLoc_96 = uint160(MulDivMath.mulDivFloor(ret.sqrtLoc_96, TwoPower.Pow96, sqrtRate_96));
                // trade at locPt
                uint256 locCurrY = MulDivMath.mulDivFloor(st.liquidity, ret.sqrtLoc_96, TwoPower.Pow96);
                (uint256 locCostX, uint256 locAcquireY) = x2YAtPriceLiquidity(desireY, ret.sqrtLoc_96, locCurrY, 0, st.liquidity);
                retState.costX += locCostX;
                retState.acquireY += locAcquireY;
                retState.finished = true;
                retState.sqrtFinalPrice_96 = ret.sqrtLoc_96;
                if (locAcquireY >= locCurrY) {
                    retState.finalPt = ret.locPt; // locPt - 1 is also ok, but need to compute finalCurrY
                    retState.finalAllX = true;
                } else {
                    retState.finalPt = ret.locPt;
                    retState.finalAllX = false;
                    retState.finalCurrY = locCurrY - locAcquireY;
                    retState.finalCurrX = locCostX;
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