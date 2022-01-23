// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './MulDivMath.sol';
import './TwoPower.sol';
import './AmountMath.sol';
import './State.sol';
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
        // whether there is no tokenY on the currentPoint
        bool finalAllX;
        // amount of tokenX(from liquidity) on final point, this value is meaningless if finalAllX is true
        uint256 finalCurrX;
        // amount of tokenY(from liquidity) on final point, this value is meaningless if finalAllX is true
        uint256 finalCurrY;
    }
    
    function y2XAtPrice(
        uint128 amountY,
        uint160 sqrtPrice_96,
        uint256 currX
    ) internal pure returns (uint128 costY, uint256 acquireX) {
        uint256 l = MulDivMath.mulDivFloor(amountY, TwoPower.Pow96, sqrtPrice_96);
        acquireX = MulDivMath.mulDivFloor(l, TwoPower.Pow96, sqrtPrice_96);
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
        uint256 currX,
        uint256 currY,
        uint128 liquidity
    ) internal pure returns (uint128 costY, uint256 acquireX) {
        uint256 currYLim = MulDivMath.mulDivCeil(liquidity, sqrtPrice_96, TwoPower.Pow96);
        uint256 deltaY = (currYLim > currY) ? currYLim - currY : 0;
        if (amountY >= deltaY) {
            costY = uint128(deltaY);
            acquireX = currX;
        } else {
            acquireX = MulDivMath.mulDivFloor(amountY, currX, deltaY);
            costY = (acquireX > 0) ? amountY : 0;
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
            uint256 sqrtLoc256_96 = MulDivMath.mulDivFloor(
                amountY,
                rg.sqrtRate_96 - TwoPower.Pow96,
                rg.liquidity
            ) + rg.sqrtPriceL_96;
            // it is believed that uint160 is enough for muldiv and adding, because amountY < maxY
            // if (sqrtLoc256_96 >= sqrtPriceR_96) {
            //     costY = maxY;
            //     acquireX = AmountMath.getAmountX(liquidity, leftPt, rightPt, sqrtPriceR_96, sqrtRate_96, false);
            //     completeLiquidity = true;
            //     return;
            // }
            (int24 locPtLo, int24 locPtHi) = LogPowMath.getLogSqrtPriceFU(uint160(sqrtLoc256_96));
            // to save one sqrt(1.0001^pt)
            bool has_sqrtLoc_96 = false;
            if (locPtLo == locPtHi) {
                ret.locPt = locPtLo;
            } else {
                ret.sqrtLoc_96 = LogPowMath.getSqrtPrice(locPtHi);
                if (ret.sqrtLoc_96 > sqrtLoc256_96) {
                    ret.locPt = locPtLo;
                } else {
                    ret.locPt = locPtHi;
                    has_sqrtLoc_96 = true;
                }
            }
            if (ret.locPt >= rg.rightPt) {
                // it is imposible
                ret.locPt = rg.rightPt - 1;
                has_sqrtLoc_96 = false;
            }
            if (ret.locPt == rg.leftPt) {
                ret.costY = 0;
                ret.acquireX = 0;
                ret.sqrtLoc_96 = rg.sqrtPriceL_96;
                ret.completeLiquidity = false;
            } else {
                if (!has_sqrtLoc_96) {
                    ret.sqrtLoc_96 = LogPowMath.getSqrtPrice(ret.locPt);
                }
                ret.costY = uint128(AmountMath.getAmountY(
                    rg.liquidity,
                    rg.sqrtPriceL_96,
                    ret.sqrtLoc_96,
                    rg.sqrtRate_96,
                    true
                ));
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
                ret.completeLiquidity = false;
            }
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
        // !allX means currY and currX is not meaningless
        if (!currentState.allX) {
            if (currentState.currX == 0) {
                // no x tokens
                currentState.currentPoint += 1;
                currentState.sqrtPrice_96 = LogPowMath.getSqrtPrice(currentState.currentPoint);
            } else {
                (retState.costY, retState.acquireX) = y2XAtPriceLiquidity(
                    amountY, 
                    currentState.sqrtPrice_96, 
                    currentState.currX,
                    currentState.currY,
                    currentState.liquidity
                );
                if (retState.acquireX < currentState.currX) {
                    // it means remaining y is not enough to rise current price to price*1.0001
                    // but y may remain, so we cannot simply use (costY == amountY)
                    retState.finished = true;
                    retState.finalAllX = false;
                    retState.finalCurrX = currentState.currX - retState.acquireX;
                    retState.finalCurrY = currentState.currY + retState.costY;
                    retState.finalPt = currentState.currentPoint;
                    retState.sqrtFinalPrice_96 = currentState.sqrtPrice_96;
                } else {
                    // acquireX == currX
                    // mint x in leftPt run out
                    if (retState.costY >= amountY) {
                        // y run out
                        retState.finished = true;
                        retState.finalPt = currentState.currentPoint + 1;
                        retState.sqrtFinalPrice_96 = LogPowMath.getSqrtPrice(retState.finalPt);
                        retState.finalAllX = true;
                    } else {
                        // y not run out
                        // not finsihed
                        currentState.currentPoint += 1;
                        amountY -= retState.costY;
                        currentState.sqrtPrice_96 = LogPowMath.getSqrtPrice(currentState.currentPoint);
                    }
                }
            }
        }

        // second, try traiding under liquidity
        // within [leftPt, rightPt)
        if (retState.finished) {
            return retState;
        }
        if (currentState.currentPoint < rightPt) {
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
                retState.finalAllX = true;
            } else {
                // trade at locPt
                uint256 locCurrX = MulDivMath.mulDivFloor(currentState.liquidity, TwoPower.Pow96, ret.sqrtLoc_96);
                
                (uint128 locCostY, uint256 locAcquireX) = y2XAtPriceLiquidity(
                    amountY,
                    ret.sqrtLoc_96,
                    locCurrX,
                    0,
                    currentState.liquidity
                );
                
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
            // if finalAllX is true
            // finalMintX(Y) is not important
        }
    }

}