// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './MulDivMath.sol';
import './TwoPower.sol';
import './AmountMath.sol';
import './State.sol';
import './MaxMinMath.sol';
import "hardhat/console.sol";


library SwapMathY2X {

    struct RangeRetState {
        // whether user has run out of tokenY
        bool finished;
        // actual cost of tokenY to buy tokenX
        uint128 costY;
        // actual amount of tokenX acquired
        uint256 acquireX;
        // final point after this swap
        int24 finalPt;
        // sqrt price on final point
        uint160 sqrtFinalPrice_96;
        // liquidity of tokenX at finalPt
        // if finalPt is not rightPt, liquidityX is meaningless
        uint128 liquidityX;
    }
    
    function y2XAtPrice(
        uint128 amountY,
        uint160 sqrtPrice_96,
        uint128 currX
    ) internal pure returns (uint128 costY, uint128 acquireX) {
        uint256 l = MulDivMath.mulDivFloor(amountY, TwoPower.Pow96, sqrtPrice_96);
        acquireX = uint128(MulDivMath.mulDivFloor(l, TwoPower.Pow96, sqrtPrice_96));
        if (acquireX > currX) {
            acquireX = currX;
        }
        l = MulDivMath.mulDivCeil(acquireX, sqrtPrice_96, TwoPower.Pow96);
        uint256 cost = MulDivMath.mulDivCeil(l, sqrtPrice_96, TwoPower.Pow96);
        costY = uint128(cost);
        // it is believed that costY <= amountY
        require(costY == cost);
    }

    function y2XAtPriceLiquidity(
        uint128 amountY,
        uint160 sqrtPrice_96,
        uint128 liquidityX
    ) internal pure returns (uint128 costY, uint256 acquireX, uint128 newLiquidityX) {
        uint256 maxTransformLiquidityY = amountY * TwoPower.Pow96 / sqrtPrice_96;
        uint128 transformLiquidityY = uint128(maxTransformLiquidityY > uint256(liquidityX) ? liquidityX : maxTransformLiquidityY);
        costY = uint128(MulDivMath.mulDivCeil(transformLiquidityY, sqrtPrice_96, TwoPower.Pow96));
        acquireX = uint256(transformLiquidityY) * TwoPower.Pow96 / sqrtPrice_96;
        newLiquidityX = liquidityX - transformLiquidityY;
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
        uint128 costY;
        uint256 acquireX;
        bool completeLiquidity;
        int24 locPt;
        uint160 sqrtLoc_96;
    }

    function y2XRangeComplete(
        Range memory rg,
        uint128 amountY
    ) internal pure returns (
        RangeCompRet memory ret
    ) {
        uint256 maxY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
        if (maxY <= amountY) {
            ret.costY = uint128(maxY);
            ret.acquireX = AmountMath.getAmountX(rg.liquidity, rg.leftPt, rg.rightPt, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
            // we complete this liquidity segment
            ret.completeLiquidity = true;
        } else {
            // we should locate highest price
            // it is believed that uint160 is enough for muldiv and adding, because amountY < maxY
            uint160 sqrtLoc_96 = uint160(MulDivMath.mulDivFloor(
                amountY,
                rg.sqrtRate_96 - TwoPower.Pow96,
                rg.liquidity
            ) + rg.sqrtPriceL_96);
            ret.locPt = LogPowMath.getLogSqrtPriceFloor(sqrtLoc_96);

            ret.locPt = MaxMinMath.max(rg.leftPt, ret.locPt);
            ret.locPt = MaxMinMath.min(rg.rightPt - 1, ret.locPt);

            ret.completeLiquidity = false;
            if (ret.locPt == rg.leftPt) {
                ret.costY = 0;
                ret.acquireX = 0;
                ret.sqrtLoc_96 = rg.sqrtPriceL_96;
                return ret;
            }
            ret.sqrtLoc_96 = LogPowMath.getSqrtPrice(ret.locPt);
            
            ret.costY = MaxMinMath.min(uint128(AmountMath.getAmountY(
                rg.liquidity,
                rg.sqrtPriceL_96,
                ret.sqrtLoc_96,
                rg.sqrtRate_96,
                true
            )), amountY);
            // it is believed that costY <= amountY even if 
            // the costY is the upperbound of the result
            // because amountY is not a real and 
            // sqrtLoc_96 <= sqrtLoc256_96
            ret.acquireX = AmountMath.getAmountX(
                rg.liquidity,
                rg.leftPt,
                ret.locPt,
                ret.sqrtLoc_96,
                rg.sqrtRate_96,
                false
            );
        
        }
    }

    /// @notice compute amount of tokens exchanged during swapY2X and some amount values (currX, currY, allX) on final point
    ///    after this swapping
    /// @param currentState state values containing (currX, currY, allX) of start point
    /// @param rightPt right most point during this swap
    /// @param sqrtRate_96 sqrt(1.0001)
    /// @param amountY max amount of Y user willing to pay
    /// @return retState amount of token acquired and some values on final point
    function y2XRange(
        State memory currentState,
        int24 rightPt,
        uint160 sqrtRate_96,
        uint128 amountY
    ) internal pure returns (
        RangeRetState memory retState
    ) {
        retState.costY = 0;
        retState.acquireX = 0;
        retState.finished = false;
        // first, if current point is not all x, we can not move right directly
        bool startHasY = (currentState.liquidityX < currentState.liquidity);
        if (startHasY) {
            (retState.costY, retState.acquireX, retState.liquidityX) = y2XAtPriceLiquidity(
                amountY, 
                currentState.sqrtPrice_96,
                currentState.liquidityX
            );
            if (retState.liquidityX > 0 || retState.costY >= amountY) {
                // it means remaining y is not enough to rise current price to price*1.0001
                // but y may remain, so we cannot simply use (costY == amountY)
                retState.finished = true;
                retState.finalPt = currentState.currentPoint;
                retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
                return retState;
            } else {
                // y not run out
                // not finsihed
                amountY -= retState.costY;
                currentState.currentPoint += 1;
                if (currentState.currentPoint == rightPt) {
                    retState.finalPt = currentState.currentPoint;
                    // get fixed sqrt price to reduce accumulated error
                    retState.sqrtFinalPrice_96 = LogPowMath.getSqrtPrice(rightPt);
                    return retState;
                }
                // sqrt(price) + sqrt(price) * (1.0001 - 1) = 
                // sqrt(price) * 1.0001
                currentState.sqrtPrice_96 = uint160(
                    uint256(currentState.sqrtPrice_96) +
                    uint256(currentState.sqrtPrice_96) * (uint256(sqrtRate_96) - TwoPower.Pow96) / TwoPower.Pow96
                );
            }
        }

        uint160 sqrtPriceR_96 = LogPowMath.getSqrtPrice(rightPt);
        // (uint128 liquidCostY, uint256 liquidAcquireX, bool liquidComplete, int24 locPt, uint160 sqrtLoc_96)
        RangeCompRet memory ret = y2XRangeComplete(
            Range({
                liquidity: currentState.liquidity,
                sqrtPriceL_96: currentState.sqrtPrice_96,
                leftPt: currentState.currentPoint,
                sqrtPriceR_96: sqrtPriceR_96,
                rightPt: rightPt,
                sqrtRate_96: sqrtRate_96
            }),
            amountY
        );

        retState.costY += ret.costY;
        amountY -= ret.costY;
        retState.acquireX += ret.acquireX;
        if (ret.completeLiquidity) {
            retState.finished = (amountY == 0);
            retState.finalPt = rightPt;
            retState.sqrtFinalPrice_96 = sqrtPriceR_96;
        } else {
            // trade at locPt
            uint128 locCostY;
            uint256 locAcquireX;
            if (startHasY && ret.locPt == currentState.currentPoint) {
                // get fixed sqrt price to reduce accumulated error
                // because ret.sqrtLoc_96 is computed from sqrtStartPrice * sqrt(1.0001)
                ret.sqrtLoc_96 = LogPowMath.getSqrtPrice(ret.locPt);
            }
            (locCostY, locAcquireX, retState.liquidityX) = y2XAtPriceLiquidity(amountY, ret.sqrtLoc_96, currentState.liquidity);
            
            retState.costY += locCostY;
            retState.acquireX += locAcquireX;
            retState.finished = true;
            retState.sqrtFinalPrice_96 = ret.sqrtLoc_96;
            retState.finalPt = ret.locPt;
        }
    }

}