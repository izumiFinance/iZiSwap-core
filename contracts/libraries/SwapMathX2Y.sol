// SPDX-License-Identifier: BUSL-1.1
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
    ) internal pure returns (uint128 costX, uint256 acquireY) {
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
    
    /// @notice compute amount of tokenY acquired and some amount values (currX, currY, allX, liquidity) on final point
    ///    during this x2y swapping
    /// @param currentState state values containing (currX, currY, allX, liquidity) of start point
    /// @param leftPt left most point during this swap
    /// @param sqrtRate_96 sqrt(1.0001)
    /// @param amountX max amount of tokenX user willing to pay
    /// @return retState amount of token acquired and some values on final point
    function x2YRange(
        State memory currentState,
        int24 leftPt,
        uint160 sqrtRate_96,
        uint128 amountX
    ) internal pure returns (
        RangeRetState memory retState
    ) {
        retState.costX = 0;
        retState.acquireY = 0;
        retState.finished = false;
        if (!currentState.allX && (currentState.currX > 0 || leftPt == currentState.currentPoint)) {
            (retState.costX, retState.acquireY) = x2YAtPriceLiquidity(
                amountX, currentState.sqrtPrice_96, currentState.currY, currentState.currX, currentState.liquidity);
            if (retState.acquireY < currentState.currY) {
                // remaining x is not enough to down current price to price / 1.0001
                // but x may remain, so we cannot simply use (costX == amountX)
                retState.finished = true;
                retState.finalAllX = false;
                retState.finalCurrY = currentState.currY - retState.acquireY;
                retState.finalCurrX = currentState.currX + retState.costX;
                retState.finalPt = currentState.currentPoint;
                retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
            } else {
                // acquireY == currY
                // currX in rightPt run out
                if (retState.costX >= amountX) {
                    retState.finished = true;
                    retState.finalPt = currentState.currentPoint;
                    retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
                    retState.finalAllX = true;
                } else {
                    amountX -= retState.costX;
                }
            }
        } else if (!currentState.allX) { // all y
            currentState.currentPoint = currentState.currentPoint + 1;
            currentState.sqrtPrice_96 = uint160(MulDivMath.mulDivFloor(currentState.sqrtPrice_96, sqrtRate_96, TwoPower.Pow96));
        }

        if (retState.finished) {
            return retState;
        }

        if (leftPt < currentState.currentPoint) {
            uint160 sqrtPriceL_96 = LogPowMath.getSqrtPrice(leftPt);
            RangeCompRet memory ret = x2YRangeComplete(
                Range({
                    liquidity: currentState.liquidity,
                    sqrtPriceL_96: sqrtPriceL_96,
                    leftPt: leftPt, 
                    sqrtPriceR_96: currentState.sqrtPrice_96, 
                    rightPt: currentState.currentPoint, 
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
                uint256 locCurrY = MulDivMath.mulDivFloor(currentState.liquidity, ret.sqrtLoc_96, TwoPower.Pow96);
                (uint128 locCostX, uint256 locAcquireY) = x2YAtPriceLiquidity(
                    amountX, ret.sqrtLoc_96, locCurrY, 0, currentState.liquidity);
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
            retState.finalPt = currentState.currentPoint;
            // all y in leftPt are converted to x
            retState.finalAllX = true;
            retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
        }
    }
    
}