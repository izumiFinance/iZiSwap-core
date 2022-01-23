// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './MulDivMath.sol';
import './TwoPower.sol';
import './AmountMath.sol';
import './State.sol';
import "hardhat/console.sol";

library SwapMathX2YDesire {
    
    // group returned values of x2YRange to avoid stake too deep
    struct RangeRetState {
        // whether user has acquire enough tokenY
        bool finished;
        // actual cost of tokenX to buy tokenY
        uint256 costX;
        // amount of acquired tokenY
        uint256 acquireY;
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
    ) internal pure returns (uint256 costX, uint128 acquireY) {
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

    /// @notice compute amount of tokens exchanged during swapX2YDesireY and some amount values (currX, currY, allX) on final point
    ///    after this swapping
    /// @param currentState state values containing (currX, currY, allX) of start point
    /// @param leftPt left most point during this swap
    /// @param sqrtRate_96 sqrt(1.0001)
    /// @param desireY amount of Y user wants to buy
    /// @return retState amount of token acquired and some values on final point
    function x2YRange(
        State memory currentState,
        int24 leftPt,
        uint160 sqrtRate_96,
        uint128 desireY
    ) internal pure returns (
        RangeRetState memory retState
    ) {
        retState.costX = 0;
        retState.acquireY = 0;
        retState.finished = false;
        if (!currentState.allX && (currentState.currX > 0 || leftPt == currentState.currentPoint)) {
            (retState.costX, retState.acquireY) = x2YAtPriceLiquidity(desireY, currentState.sqrtPrice_96, currentState.currY, currentState.currX, currentState.liquidity);
            if (retState.acquireY < currentState.currY) {
                retState.finished = true;
                retState.finalAllX = false;
                retState.finalCurrY = currentState.currY - retState.acquireY;
                retState.finalCurrX = currentState.currX + retState.costX;
                retState.finalPt = currentState.currentPoint;
                retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
            } else {
                if (retState.acquireY >= desireY) {
                    retState.finished = true;
                    retState.finalPt = currentState.currentPoint;
                    retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
                    retState.finalAllX = true;
                } else {
                    desireY -= uint128(retState.acquireY);
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
                uint256 locCurrY = MulDivMath.mulDivFloor(currentState.liquidity, ret.sqrtLoc_96, TwoPower.Pow96);
                (uint256 locCostX, uint256 locAcquireY) = x2YAtPriceLiquidity(desireY, ret.sqrtLoc_96, locCurrY, 0, currentState.liquidity);
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
            retState.finalAllX = true;
            retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
        }
    }
}