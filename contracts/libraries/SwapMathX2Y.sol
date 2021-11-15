pragma solidity >=0.7.3;

import './MulDivMath.sol';
import './TwoPower.sol';
import './AmountMath.sol';
import './State.sol';
import "hardhat/console.sol";

library SwapMathX2Y {

    struct RangeRetState {
        bool finished;
        uint128 costX;
        uint256 acquireY;
        int24 finalPt;
        uint160 sqrtFinalPrice_96;
        bool finalAllX;
        uint256 finalCurrX;
        uint256 finalCurrY;
    }

    function x2YAtPrice(
        uint128 amountX,
        uint160 sqrtPrice_96,
        uint256 currY
    ) internal pure returns (uint128 costX, uint256 acquireY) {
        uint256 l = MulDivMath.mulDivFloor(amountX, sqrtPrice_96, TwoPower.Pow96);
        acquireY = MulDivMath.mulDivFloor(l, sqrtPrice_96, TwoPower.Pow96);
        if (acquireY > currY) {
            acquireY = currY;
        }
        l = MulDivMath.mulDivCeil(acquireY, TwoPower.Pow96, sqrtPrice_96);
        uint256 cost = MulDivMath.mulDivCeil(l, TwoPower.Pow96, sqrtPrice_96);
        costX = uint128(cost);
        // it is believed that costX <= amountX
        require(costX == cost);
    }

    function x2YAtPriceLiquidity(
        uint128 amountX,
        uint160 sqrtPrice_96,
        uint256 currY,
        uint256 currX,
        uint128 liquidity
    ) internal view returns (uint128 costX, uint256 acquireY) {
        uint256 currXLim = MulDivMath.mulDivCeil(liquidity, TwoPower.Pow96, sqrtPrice_96);
        uint256 deltaX = (currXLim > currX) ? currXLim - currX : 0;
        if (amountX >= deltaX) {
            costX = uint128(deltaX);
            acquireY = currY;
        } else {
            acquireY = MulDivMath.mulDivFloor(amountX, currY, deltaX);
            costX = (acquireY > 0) ? amountX : 0;
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
        uint128 costX;
        uint256 acquireY;
        bool completeLiquidity;
        int24 locPt;
        uint160 sqrtLoc_96;
    }
    /// @dev move from rightPt to leftPt, the range is [leftPt, rightPt)
    function x2YRangeComplete(
        Range memory rg,
        uint128 amountX
    ) internal pure returns (
        RangeCompRet memory ret
    ) {
        uint160 sqrtPricePrPd_96 = LogPowMath.getSqrtPrice(rg.rightPt + 1);
        uint160 sqrtPricePrPc_96 = LogPowMath.getSqrtPrice(rg.rightPt - (rg.leftPt - 1));
        uint256 maxX = MulDivMath.mulDivCeil(rg.liquidity, sqrtPricePrPc_96 - rg.sqrtRate_96, sqrtPricePrPd_96 - rg.sqrtPriceR_96);
        if (maxX <= amountX) {
            ret.costX = uint128(maxX);
            ret.acquireY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
            ret.completeLiquidity = true;
        } else {
            // we should locate lowest price
            uint256 sqrtValue256_96 = MulDivMath.mulDivFloor(
                amountX,
                sqrtPricePrPd_96 - rg.sqrtPriceR_96,
                rg.liquidity
            ) + rg.sqrtRate_96;
            uint160 sqrtValue_96 = uint160(sqrtValue256_96);
            require(sqrtValue256_96 == sqrtValue_96, "X2YVOF");
            int24 logValue = LogPowMath.getLogSqrtPriceFloor(sqrtValue_96);
            ret.locPt = rg.rightPt + 1 - logValue;
            if (ret.locPt <= rg.leftPt) {
                // it is impossible
                ret.locPt = rg.leftPt + 1;
            }
            if (ret.locPt == rg.rightPt) {
                ret.costX = 0;
                ret.acquireY = 0;
                ret.sqrtLoc_96 = rg.sqrtPriceR_96;
                ret.completeLiquidity = false;
            } else {
                uint160 sqrtPricePrPloc_96 = LogPowMath.getSqrtPrice(rg.rightPt - (ret.locPt - 1));
                ret.costX = uint128(MulDivMath.mulDivCeil(
                    rg.liquidity, sqrtPricePrPloc_96 - rg.sqrtRate_96, sqrtPricePrPd_96 - rg.sqrtPriceR_96
                ));
                ret.sqrtLoc_96 = LogPowMath.getSqrtPrice(ret.locPt);
                ret.acquireY = AmountMath.getAmountY(rg.liquidity, ret.sqrtLoc_96, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
                ret.completeLiquidity = false;
            }
        }
    }
    
    function x2YRange(
        State memory st,
        int24 leftPt,
        uint160 sqrtRate_96,
        uint128 amountX
    ) internal view returns (
        // bool finished,
        // uint128 costX,
        // uint256 acquireY,
        // int24 finalPt,
        // uint160 sqrtFinalPrice_96,
        // bool finalAllX,
        // uint256 finalCurrX,
        // uint256 finalCurrY
        RangeRetState memory retState
    ) {
        retState.costX = 0;
        retState.acquireY = 0;
        retState.finished = false;
        if (!st.allX && (st.currX > 0 || leftPt == st.currPt)) {
            (retState.costX, retState.acquireY) = x2YAtPriceLiquidity(
                amountX, st.sqrtPrice_96, st.currY, st.currX, st.liquidity);
            if (retState.acquireY < st.currY) {
                // remaining x is not enough to down current price to price / 1.0001
                // but x may remain, so we cannot simply use (costX == amountX)
                retState.finished = true;
                retState.finalAllX = false;
                retState.finalCurrY = st.currY - retState.acquireY;
                retState.finalCurrX = st.currX + retState.costX;
                retState.finalPt = st.currPt;
                retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
            } else {
                // acquireY == currY
                // currX in rightPt run out
                if (retState.costX >= amountX) {
                    retState.finished = true;
                    retState.finalPt = st.currPt;
                    retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
                    retState.finalAllX = true;
                } else {
                    amountX -= retState.costX;
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
                amountX
            );
            retState.costX += ret.costX;
            amountX -= ret.costX;
            retState.acquireY += ret.acquireY;
            if (ret.completeLiquidity) {
                retState.finished = (amountX == 0);
                retState.finalPt = leftPt;
                retState.sqrtFinalPrice_96 = sqrtPriceL_96;
                retState.finalAllX = true;
            } else {
                ret.locPt = ret.locPt - 1;
                ret.sqrtLoc_96 = uint160(MulDivMath.mulDivFloor(ret.sqrtLoc_96, TwoPower.Pow96, sqrtRate_96));
                // trade at locPt
                uint256 locCurrY = MulDivMath.mulDivFloor(st.liquidity, ret.sqrtLoc_96, TwoPower.Pow96);
                (uint128 locCostX, uint256 locAcquireY) = x2YAtPriceLiquidity(
                    amountX, ret.sqrtLoc_96, locCurrY, 0, st.liquidity);
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
            // all y in leftPt are converted to x
            retState.finalAllX = true;
            retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
        }
    }
    
}