pragma solidity >=0.7.3;

import './FullMath.sol';
import './FixedPoint96.sol';
import './AmountMath.sol';
import './State.sol';
import "hardhat/console.sol";


library SwapMathY2X {

    struct RangeRetState {
        bool finished;
        uint128 costY;
        uint256 acquireX;
        int24 finalPt;
        uint160 sqrtFinalPrice_96;
        bool finalAllX;
        uint256 finalCurrX;
        uint256 finalCurrY;
    }
    
/*
    /// @dev trader pays token y and acquire x at a certain price
    function y2XAtPriceLimit(
        uint256 price_96,
        uint128 amountY,
        uint256 amountXAtPoint
    ) internal pure returns (uint128 costY, uint256 acquireX) {
        uint256 allX = (amountY << 96) / price_96;
        if (allX <= amountXAtPoint) {
            // amountX at the point is enough
            // it is believed that costY <= amountY
            costY = FullMath.mulDivRoundingUp(allX, price_96, FixedPoint96.Q96);
            acquireX = allX;
        } else {
            // it is beleived that costY <= amountY
            costY = FullMath.mulDivRoundingUp(amountXAtPoint, price_96, FixedPoint96.Q96);
            acquireX = amountXAtPoint;
        }
    }
*/
    function y2XAtPriceLiquidity(
        uint128 amountY,
        uint160 sqrtPrice_96,
        uint256 currX
    ) internal view returns (uint128 costY, uint256 acquireX) {
        uint256 l = FullMath.mulDiv(amountY, FixedPoint96.Q96, sqrtPrice_96);
        acquireX = FullMath.mulDiv(l, FixedPoint96.Q96, sqrtPrice_96);
        if (acquireX > currX) {
            acquireX = currX;
        }
        l = FullMath.mulDivRoundingUp(acquireX, sqrtPrice_96, FixedPoint96.Q96);
        uint256 cost = FullMath.mulDivRoundingUp(l, sqrtPrice_96, FixedPoint96.Q96);
        costY = uint128(cost);
        // it is believed that costY <= amountY
        require(costY == cost);
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
        // uint128 costY, 
        // uint256 acquireX, 
        // bool completeLiquidity, 
        // int24 locPt,
        // uint160 sqrtLoc_96
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
            uint256 sqrtLoc256_96 = FullMath.mulDiv(
                amountY,
                rg.sqrtRate_96 - FixedPoint96.Q96,
                rg.liquidity
            ) + rg.sqrtPriceL_96;
            // it is believed that uint160 is enough for muldiv and adding, because amountY < maxY
            // if (sqrtLoc256_96 >= sqrtPriceR_96) {
            //     costY = maxY;
            //     acquireX = AmountMath.getAmountX(liquidity, leftPt, rightPt, sqrtPriceR_96, sqrtRate_96, false);
            //     completeLiquidity = true;
            //     return;
            // }
            (int24 locPtLo, int24 locPtHi) = TickMath.getTickAtSqrtRatioLH(uint160(sqrtLoc256_96));
            // to save one sqrt(1.0001^pt)
            bool has_sqrtLoc_96 = false;
            if (locPtLo == locPtHi) {
                ret.locPt = locPtLo;
            } else {
                ret.sqrtLoc_96 = TickMath.getSqrtRatioAtTick(locPtHi);
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
                    ret.sqrtLoc_96 = TickMath.getSqrtRatioAtTick(ret.locPt);
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

    function y2XRange(
        // uint128 liquidity,
        // int24 leftPt,
        // uint160 sqrtPriceL_96,
        // bool allX,
        // uint256 currX,
        // uint256 currY,
        State memory st,
        int24 rightPt,
        uint160 sqrtRate_96,
        uint128 amountY
    ) internal view returns (
        // bool finished,
        // uint128 costY,
        // uint256 acquireX,
        // int24 finalPt,
        // uint160 sqrtFinalPrice_96,
        // bool finalAllX,
        // uint256 finalCurrX,
        // uint256 finalCurrY
        RangeRetState memory retState
    ) {
        retState.costY = 0;
        retState.acquireX = 0;
        retState.finished = false;
        // first, if current point is not all x, we can not move right directly
        // !allX means currY and currX is not meaningless
        if (!st.allX) {
            if (st.currX == 0) {
                // no x tokens
                st.currPt += 1;
                st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
            } else {
                (retState.costY, retState.acquireX) = y2XAtPriceLiquidity(amountY, st.sqrtPrice_96, st.currX);
                if (retState.acquireX < st.currX) {
                    // it means remaining y is not enough to rise current price to price*1.0001
                    // but y may remain, so we cannot simply use (costY == amountY)
                    retState.finished = true;
                    retState.finalAllX = false;
                    retState.finalCurrX = st.currX - retState.acquireX;
                    retState.finalCurrY = st.currY + retState.costY;
                    retState.finalPt = st.currPt;
                    retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
                } else {
                    // acquireX == currX
                    // mint x in leftPt run out
                    if (retState.costY >= amountY) {
                        // y run out
                        retState.finished = true;
                        retState.finalPt = st.currPt + 1;
                        retState.sqrtFinalPrice_96 = TickMath.getSqrtRatioAtTick(retState.finalPt);
                        retState.finalAllX = true;
                    } else {
                        // y not run out
                        // not finsihed
                        st.currPt += 1;
                        amountY -= retState.costY;
                        st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                    }
                }
            }
        }

        // second, try traiding under liquidity
        // within [leftPt, rightPt)
        if (retState.finished) {
            return retState;
        }
        if (st.currPt < rightPt) {
            uint160 sqrtPriceR_96 = TickMath.getSqrtRatioAtTick(rightPt);
            // (uint128 liquidCostY, uint256 liquidAcquireX, bool liquidComplete, int24 locPt, uint160 sqrtLoc_96)
            RangeCompRet memory ret = y2XRangeComplete(
                Range({
                    liquidity: st.liquidity,
                    sqrtPriceL_96: st.sqrtPrice_96,
                    leftPt: st.currPt,
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
                uint256 locCurrX = FullMath.mulDiv(st.liquidity, FixedPoint96.Q96, ret.sqrtLoc_96);
                
                (uint128 locCostY, uint256 locAcquireX) = y2XAtPriceLiquidity(amountY, ret.sqrtLoc_96, locCurrX);
                
                retState.costY += locCostY;
                retState.acquireX += locAcquireX;
                retState.finished = true;
                if (locAcquireX >= locCurrX) {
                    retState.finalPt = ret.locPt + 1;
                    retState.sqrtFinalPrice_96 = TickMath.getSqrtRatioAtTick(retState.finalPt);
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
            retState.finalPt = st.currPt;
            retState.finalAllX = true;
            retState.sqrtFinalPrice_96 = st.sqrtPrice_96;
            // if finalAllX is true
            // finalMintX(Y) is not important
        }
    }

}