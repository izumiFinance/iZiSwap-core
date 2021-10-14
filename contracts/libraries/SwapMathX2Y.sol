pragma solidity >=0.7.3;

import './FullMath.sol';
import './FixedPoint96.sol';
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

    function x2YAtPriceLiquidity(
        uint128 amountX,
        uint160 sqrtPrice_96,
        uint256 currY
    ) internal pure returns (uint128 costX, uint256 acquireY) {
        uint256 l = FullMath.mulDiv(amountX, sqrtPrice_96, FixedPoint96.Q96);
        acquireY = FullMath.mulDiv(l, sqrtPrice_96, FixedPoint96.Q96);
        if (acquireY > currY) {
            acquireY = currY;
        }
        l = FullMath.mulDivRoundingUp(acquireY, FixedPoint96.Q96, sqrtPrice_96);
        uint256 cost = FullMath.mulDivRoundingUp(l, FixedPoint96.Q96, sqrtPrice_96);
        costX = uint128(cost);
        // it is believed that costX <= amountX
        require(costX == cost);
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
        uint160 sqrtPricePrPd_96 = TickMath.getSqrtRatioAtTick(rg.rightPt + 1);
        uint160 sqrtPricePrPc_96 = TickMath.getSqrtRatioAtTick(rg.rightPt - (rg.leftPt - 1));
        uint256 maxX = FullMath.mulDivRoundingUp(rg.liquidity, sqrtPricePrPc_96 - rg.sqrtRate_96, sqrtPricePrPd_96 - rg.sqrtPriceR_96);
        if (maxX <= amountX) {
            ret.costX = uint128(maxX);
            ret.acquireY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
            ret.completeLiquidity = true;
        } else {
            // we should locate lowest price
            uint256 sqrtValue256_96 = FullMath.mulDiv(
                amountX,
                sqrtPricePrPd_96 - rg.sqrtPriceR_96,
                rg.liquidity
            ) + rg.sqrtRate_96;
            uint160 sqrtValue_96 = uint160(sqrtValue256_96);
            require(sqrtValue256_96 == sqrtValue_96, "X2YVOF");
            int24 logValue = TickMath.getTickAtSqrtRatio(sqrtValue_96);
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
                uint160 sqrtPricePrPloc_96 = TickMath.getSqrtRatioAtTick(rg.rightPt - (ret.locPt - 1));
                ret.costX = uint128(FullMath.mulDivRoundingUp(
                    rg.liquidity, sqrtPricePrPloc_96 - rg.sqrtRate_96, sqrtPricePrPd_96 - rg.sqrtPriceR_96
                ));
                ret.sqrtLoc_96 = TickMath.getSqrtRatioAtTick(ret.locPt);
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
            (retState.costX, retState.acquireY) = x2YAtPriceLiquidity(amountX, st.sqrtPrice_96, st.currY);
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
                    console.log("++++++++++++++++++++++++");
                    console.log("== costX: %s", retState.costX);
                    console.log("== acquireY: %s", retState.acquireY);
                    console.log("== currPt: %s", uint256(int256(st.currPt)));
                }
            }
        } else if (!st.allX) { // all y
            st.currPt = st.currPt + 1;
            st.sqrtPrice_96 = uint160(FullMath.mulDiv(st.sqrtPrice_96, sqrtRate_96, FixedPoint96.Q96));
        }

        if (retState.finished) {
            return retState;
        }

        if (leftPt < st.currPt) {
            uint160 sqrtPriceL_96 = TickMath.getSqrtRatioAtTick(leftPt);
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
                console.log("++++++++++++++++++++++++");
                console.log("== costX: %s", ret.costX);
                console.log("== acquireY: %s", ret.acquireY);
                console.log("== [%s, %s)", uint256(int256(leftPt)), uint256(int256(st.currPt)));
                console.log("== complete liquid at: %s", uint256(int256(leftPt)));
            } else {
                console.log("++++++++++++++++++++++++");
                console.log("== costX: %s", ret.costX);
                console.log("== acquireY: %s", ret.acquireY);
                console.log("== [%s, %s)", uint256(int256(ret.locPt)), uint256(int256(st.currPt)));
                ret.locPt = ret.locPt - 1;
                ret.sqrtLoc_96 = uint160(FullMath.mulDiv(ret.sqrtLoc_96, FixedPoint96.Q96, sqrtRate_96));
                // trade at locPt
                uint256 locCurrY = FullMath.mulDiv(st.liquidity, ret.sqrtLoc_96, FixedPoint96.Q96);
                (uint128 locCostX, uint256 locAcquireY) = x2YAtPriceLiquidity(amountX, ret.sqrtLoc_96, locCurrY);
                retState.costX += locCostX;
                retState.acquireY += locAcquireY;
                retState.finished = true;
                retState.sqrtFinalPrice_96 = ret.sqrtLoc_96;

                console.log("++++++++++++++++++++++++");
                console.log("== costX: %s", locCostX);
                console.log("== acquireY: %s", locAcquireY);
                console.log("== currPt: %s", uint256(int256(ret.locPt)));

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