// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './MulDivMath.sol';
import './TwoPower.sol';
import './AmountMath.sol';
import './State.sol';
import "hardhat/console.sol";

library SwapMathX2Y {

    // group returned values of x2YRange to avoid stake too deep
    struct RangeRetState {
        // whether user run out of amountX
        bool finished;
        // actual cost of tokenX to buy tokenY
        uint128 costX;
        // amount of acquired tokenY
        uint256 acquireY;
        // final point after this swap
        int24 finalPt;
        // sqrt price on final point
        uint160 sqrtFinalPrice_96;
        // liquidity of tokenX at finalPt
        uint128 liquidityX;
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

    function mulDivCeil(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        uint256 v = a * b;
        if (v % c == 0) {
            return v / c;
        }
        return v / c + 1;
    }

    function x2YAtPriceLiquidity(
        uint128 amountX,
        uint160 sqrtPrice_96,
        uint128 liquidity,
        uint128 liquidityX
    ) internal pure returns (uint128 costX, uint256 acquireY, uint128 newLiquidityX) {
        uint256 liquidityY = uint256(liquidity - liquidityX);
        uint256 maxTransformLiquidityX = MulDivMath.mulDivFloor(amountX, sqrtPrice_96, TwoPower.Pow96);

        // transformLiquidityX <= floor(amountX * sqrtPrice_96 / TwoPower.Pow96)
        uint128 transformLiquidityX = uint128((maxTransformLiquidityX > liquidityY) ? liquidityY : maxTransformLiquidityX);

        // ceil(transformLiquidityX * sqrtPrice_96 / TwoPower.Pow96) <=
        // ceil(floor(amountX * sqrtPrice_96 / TwoPower.Pow96) * sqrtPrice_96 / TwoPower.Pow96) <=
        // ceil(amountX * sqrtPrice_96 / TwoPower.Pow96 * sqrtPrice_96 / TwoPower.Pow96) =
        // ceil(amountX) = amountX
        costX = uint128(mulDivCeil(transformLiquidityX, TwoPower.Pow96, sqrtPrice_96));
        acquireY = MulDivMath.mulDivFloor(transformLiquidityX, sqrtPrice_96, TwoPower.Pow96);
        newLiquidityX = liquidityX + transformLiquidityX;
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
    
    /// @notice compute amount of tokens exchanged during swapX2Y
    ///    and some amount values (currX, currY, allX) on final point
    ///    after this swapping
    /// @param currentState state values containing (currX, currY, allX) of start point
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
        // if (!currentState.allX && (currentState.currX > 0 || leftPt == currentState.currentPoint)) {
        bool currentHasY = (currentState.liquidityX < currentState.liquidity);
        if (currentHasY && (currentState.liquidityX > 0 || leftPt == currentState.currentPoint)) {
            (retState.costX, retState.acquireY, retState.liquidityX) = x2YAtPriceLiquidity(
                amountX, currentState.sqrtPrice_96, currentState.liquidity, currentState.liquidityX
            );
            if (retState.liquidityX < currentState.liquidity ||  retState.costX >= amountX) {
                // remaining x is not enough to down current price to price / 1.0001
                // but x may remain, so we cannot simply use (costX == amountX)
                retState.finished = true;
                retState.finalPt = currentState.currentPoint;
                retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
            } else {
                amountX -= retState.costX;
            }
        } else if (currentHasY) { // all y
            currentState.currentPoint = currentState.currentPoint + 1;
            currentState.sqrtPrice_96 = uint160(
                currentState.sqrtPrice_96 +
                currentState.sqrtPrice_96 * (sqrtRate_96 - TwoPower.Pow96) / TwoPower.Pow96
            );
        } else {
            retState.liquidityX = currentState.liquidityX;
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
                retState.liquidityX = currentState.liquidity;
            } else {
                ret.locPt = ret.locPt - 1;
                ret.sqrtLoc_96 = uint160(MulDivMath.mulDivFloor(ret.sqrtLoc_96, TwoPower.Pow96, sqrtRate_96));
                uint128 locCostX;
                uint256 locAcquireY;
                (locCostX, locAcquireY, retState.liquidityX) = x2YAtPriceLiquidity(amountX, ret.sqrtLoc_96, currentState.liquidity, 0);
                retState.costX += locCostX;
                retState.acquireY += locAcquireY;
                retState.finished = true;
                retState.sqrtFinalPrice_96 = ret.sqrtLoc_96;
                retState.finalPt = ret.locPt;
            }
        } else {
            // finishd must be false
            // retState.finished = false;
            // liquidityX has been set
            retState.finalPt = currentState.currentPoint;
            retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
        }
    }
    
}