// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './MulDivMath.sol';
import './TwoPower.sol';
import './AmountMath.sol';
import './State.sol';
import "hardhat/console.sol";

library SwapMathY2XDesire {

    struct RangeRetState {
        // whether user acquires enough tokenX
        bool finished;
        // actual cost of tokenY to buy tokenX
        uint256 costY;
        // actual amount of tokenX acquired
        uint128 acquireX;
        // final point after this swap
        int24 finalPt;
        // sqrt price on final point
        uint160 sqrtFinalPrice_96;
        // liquidity of tokenX at finalPt
        // if finalPt is not rightPt, liquidityX is meaningless
        uint128 liquidityX;
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
        uint128 liquidityX
    ) internal pure returns (uint256 costY, uint128 acquireX, uint128 newLiquidityX) {
        uint256 maxTransformLiquidityY = MulDivMath.mulDivFloor(desireX, sqrtPrice_96, TwoPower.Pow96);
        uint128 transformLiquidityY = uint128((maxTransformLiquidityY > liquidityX) ? liquidityX : maxTransformLiquidityY);
        costY = MulDivMath.mulDivCeil(transformLiquidityY, sqrtPrice_96, TwoPower.Pow96);
        acquireX = uint128(uint256(transformLiquidityY) * TwoPower.Pow96 / sqrtPrice_96);
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
        uint256 costY;
        uint128 acquireX;
        bool completeLiquidity;
        int24 locPt;
        uint160 sqrtLoc_96;
    }
    
    function y2XRangeComplete(
        Range memory rg,
        uint128 desireX
    ) internal pure returns (
        RangeCompRet memory ret
    ) {
        uint256 maxX = AmountMath.getAmountX(rg.liquidity, rg.leftPt, rg.rightPt, rg.sqrtPriceR_96, rg.sqrtRate_96, false);
        if (maxX <= desireX) {
            ret.acquireX = uint128(maxX);
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
            ret.acquireX = desireX;
            ret.costY = AmountMath.getAmountY(rg.liquidity, rg.sqrtPriceL_96, rg.sqrtPriceR_96, rg.sqrtRate_96, true);
            ret.completeLiquidity = true;
            return ret;
        }
        div -= dcl;
        // sqrtPriceL_96 * Q96 < 2^256, because sqrtPriceL_96 is uint160
        uint256 sqrtPriceLoc_96 = rg.sqrtPriceL_96 * TwoPower.Pow96 / div;
        if (sqrtPriceLoc_96 >= rg.sqrtPriceR_96) {
            // also imposible
            ret.acquireX = desireX;
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
            ret.acquireX = desireX;
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
        ret.acquireX = uint128(AmountMath.getAmountX(
            rg.liquidity,
            rg.leftPt,
            ret.locPt,
            ret.sqrtLoc_96,
            rg.sqrtRate_96,
            false
        ));
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

    /// @notice compute amount of tokens exchanged during swapY2XDesireY and some amount values (currX, currY, allX) on final point
    ///    after this swapping
    /// @param currentState state values containing (currX, currY, allX) of start point
    /// @param rightPt right most point during this swap
    /// @param sqrtRate_96 sqrt(1.0001)
    /// @param desireX amount of tokenX user wants to buy
    /// @return retState amount of token acquired and some values on final point
    function y2XRange(
        State memory currentState,
        int24 rightPt,
        uint160 sqrtRate_96,
        uint128 desireX
    ) internal pure returns (
        RangeRetState memory retState
    ) {
        retState.costY = 0;
        retState.acquireX = 0;
        retState.finished = false;
        // first, if current point is not all x, we can not move right directly
        bool currentHasY = (currentState.liquidityX < currentState.liquidity);
        if (currentHasY) {
            (retState.costY, retState.acquireX, retState.liquidityX) = y2XAtPriceLiquidity(desireX, currentState.sqrtPrice_96, currentState.liquidityX);
            if (retState.liquidityX < currentState.liquidity || retState.acquireX >= desireX) {
                // currX remain, means desire runout
                retState.finished = true;
                retState.finalPt = currentState.currentPoint;
                retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
            } else {
                // not finished
                currentState.currentPoint += 1;
                // sqrt(price) + sqrt(price) * (1.0001 - 1) = 
                // sqrt(price) * 1.0001
                currentState.sqrtPrice_96 = uint160(
                    uint256(currentState.sqrtPrice_96) +
                    uint256(currentState.sqrtPrice_96) * (uint256(sqrtRate_96) - TwoPower.Pow96) / TwoPower.Pow96
                );
                desireX -= retState.acquireX;
            }
        }
        if (retState.finished) {
            return retState;
        }
        if (currentState.currentPoint < rightPt) {
            uint160 sqrtPriceR_96 = LogPowMath.getSqrtPrice(rightPt);
            RangeCompRet memory ret = y2XRangeComplete(
                Range({
                    liquidity: currentState.liquidity,
                    sqrtPriceL_96: currentState.sqrtPrice_96,
                    leftPt: currentState.currentPoint,
                    sqrtPriceR_96: sqrtPriceR_96,
                    rightPt: rightPt,
                    sqrtRate_96: sqrtRate_96
                }), 
                desireX
            );
            retState.costY += ret.costY;
            retState.acquireX += ret.acquireX;
            desireX -= ret.acquireX;
            if (ret.completeLiquidity) {
                retState.finished = (desireX == 0);
                retState.finalPt = rightPt;
                retState.sqrtFinalPrice_96 = sqrtPriceR_96;
            } else {
                uint256 locCostY;
                uint128 locAcquireX;
                (locCostY, locAcquireX, retState.liquidityX) = y2XAtPriceLiquidity(desireX, ret.sqrtLoc_96, currentState.liquidity);
                retState.costY += locCostY;
                retState.acquireX += locAcquireX;
                retState.finished = true;
                retState.finalPt = ret.locPt;
                retState.sqrtFinalPrice_96 = ret.sqrtLoc_96;
            }
        } else {
            // finishd must be false
            // retState.finished = false;
            retState.finalPt = currentState.currentPoint;
            retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
        }
    }
}