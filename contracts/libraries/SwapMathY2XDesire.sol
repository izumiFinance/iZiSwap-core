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
        uint256 acquireX;
        // final point after this swap
        int24 finalPt;
        // sqrt price on final point
        uint160 sqrtFinalPrice_96;
        // whether there is no tokenY on the currentPoint
        bool finalAllX;
        // amount of tokenX(from liquidity) on final point, this value is meaningless if finalAllX is true
        uint256 finalCurrX;
        // amount of tokenY(from liquidity) on final point, this value is meaningless if finalAllX is true
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
    ) internal pure returns (uint256 costY, uint128 acquireX) {
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
    ) internal pure returns (
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
        if (!currentState.allX) {
            if (currentState.currX == 0) {
                currentState.currentPoint += 1;
                currentState.sqrtPrice_96 = uint160(MulDivMath.mulDivFloor(currentState.sqrtPrice_96, sqrtRate_96, TwoPower.Pow96));
            } else {
                (retState.costY, retState.acquireX) = y2XAtPriceLiquidity(desireX, currentState.sqrtPrice_96, currentState.currX, currentState.currY, currentState.liquidity);
                if (retState.acquireX < currentState.currX) {
                    // currX remain, means desire runout
                    retState.finished = true;
                    retState.finalAllX = false;
                    retState.finalCurrX = currentState.currX - retState.acquireX;
                    retState.finalCurrY = currentState.currY + retState.costY;
                    retState.finalPt = currentState.currentPoint;
                    retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
                } else {
                    if (retState.acquireX >= desireX) {
                        // currX not remain but desire runout
                        retState.finished = true;
                        retState.finalPt = currentState.currentPoint + 1;
                        retState.sqrtFinalPrice_96 = LogPowMath.getSqrtPrice(retState.finalPt);
                        retState.finalAllX = true;
                    } else {
                        // not finished
                        currentState.currentPoint += 1;
                        desireX -= uint128(retState.acquireX);
                        currentState.sqrtPrice_96 = LogPowMath.getSqrtPrice(currentState.currentPoint);
                    }
                }
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
            desireX = (desireX <= ret.acquireX) ? 0 : desireX - uint128(ret.acquireX);
            if (ret.completeLiquidity) {
                retState.finished = (desireX == 0);
                retState.finalPt = rightPt;
                retState.sqrtFinalPrice_96 = sqrtPriceR_96;
                retState.finalAllX = true;
            } else {
                uint256 locCurrX = uint256(currentState.liquidity) * TwoPower.Pow96 / ret.sqrtLoc_96;
                (uint256 locCostY, uint128 locAcquireX) = y2XAtPriceLiquidity(desireX, ret.sqrtLoc_96, locCurrX, 0, currentState.liquidity);
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
            retState.finalPt = currentState.currentPoint;
            retState.finalAllX = true;
            retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
        }
    }
}