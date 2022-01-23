// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './interfaces/IiZiSwapPool.sol';
import './libraries/Liquidity.sol';
import './libraries/Point.sol';
import './libraries/PointBitmap.sol';
import './libraries/LogPowMath.sol';
import './libraries/MulDivMath.sol';
import './libraries/TwoPower.sol';
import './libraries/LimitOrder.sol';
import './libraries/SwapMathY2X.sol';
import './libraries/SwapMathX2Y.sol';
import './libraries/SwapMathY2XDesire.sol';
import './libraries/SwapMathX2YDesire.sol';
import './libraries/TokenTransfer.sol';
import './libraries/UserEarn.sol';
import './libraries/State.sol';
import './libraries/Oracle.sol';
import './interfaces/IiZiSwapCallback.sol';

import 'hardhat/console.sol';

contract MintModule {

    // TODO following usings may need modify
    using Liquidity for mapping(bytes32 =>Liquidity.Data);
    using Liquidity for Liquidity.Data;
    using Point for mapping(int24 =>Point.Data);
    using Point for Point.Data;
    using PointBitmap for mapping(int16 =>uint256);
    using LimitOrder for LimitOrder.Data;
    using UserEarn for UserEarn.Data;
    using UserEarn for mapping(bytes32 =>UserEarn.Data);
    using SwapMathY2X for SwapMathY2X.RangeRetState;
    using SwapMathX2Y for SwapMathX2Y.RangeRetState;
    using Oracle for Oracle.Observation[65535];

    // TODO following values need change
    int24 internal constant LEFT_MOST_PT = -800000;
    int24 internal constant RIGHT_MOST_PT = 800000;

    int24 private leftMostPt;
    int24 private rightMostPt;
    uint128 private maxLiquidPt;

    address public factory;
    address public tokenX;
    address public tokenY;
    uint24 public fee;
    int24 public pointDelta;

    uint256 public feeScaleX_128;
    uint256 public feeScaleY_128;

    uint160 public sqrtRate_96;

    // struct State {
    //     uint160 sqrtPrice_96;
    //     int24 currentPoint;
    //     uint256 currX;
    //     uint256 currY;
    //     // liquidity from currentPoint to right
    //     uint128 liquidity;
    //     bool allX;
    //     bool locked;
    // }
    State public state;

    struct Cache {
        uint256 currFeeScaleX_128;
        uint256 currFeeScaleY_128;
        bool finished;
        uint160 _sqrtRate_96;
        int24 pd;
        int24 currVal;
        int24 startPoint;
        uint128 startLiquidity;
        uint32 timestamp;
    }
    // struct WithdrawRet {
    //     uint256 x;
    //     uint256 y;
    //     uint256 xc;
    //     uint256 yc;
    //     uint256 currX;
    //     uint256 currY;
    // }

    /// TODO: following mappings may need modify
    mapping(bytes32 =>Liquidity.Data) public liquidities;
    mapping(int16 =>uint256) pointBitmap;
    mapping(int24 =>Point.Data) points;
    mapping(int24 =>int24) public orderOrEndpoint;
    mapping(int24 =>LimitOrder.Data) public limitOrderData;
    mapping(bytes32 => UserEarn.Data) userEarnX;
    mapping(bytes32 => UserEarn.Data) userEarnY;
    Oracle.Observation[65535] public observations;
    
    address private  original;

    address private swapModuleX2Y;
    address private swapModuleY2X;
    address private mintMudule;
    // address private immutable original;

    struct WithdrawRet {
        uint256 x;
        uint256 y;
        uint256 xc;
        uint256 yc;
        uint256 currX;
        uint256 currY;
    }

    function balanceX() private view returns (uint256) {
        (bool success, bytes memory data) =
            tokenX.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, address(this)));
        require(success && data.length >= 32);
        return abi.decode(data, (uint256));
    }

    function balanceY() private view returns (uint256) {
        (bool success, bytes memory data) =
            tokenY.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, address(this)));
        require(success && data.length >= 32);
        return abi.decode(data, (uint256));
    }

    function getStatusVal(int24 point, int24 pd) internal view returns(int24 val) {
        if (point % pd != 0) {
            return 0;
        }
        val = orderOrEndpoint[point / pd];
    }
    function setStatusVal(int24 point, int24 pd, int24 val) internal {
        orderOrEndpoint[point / pd] = val;
    }

    /// @dev Add / Dec liquidity of a minter
    /// @param minter the minter of the liquidity
    /// @param pl left endpoint of the segment
    /// @param pr right endpoint of the segment, [pl, pr)
    /// @param delta delta liquidity, positive for adding
    /// @param currentPoint current price point on the axies
    function _updateLiquidity(
        address minter,
        int24 pl,
        int24 pr,
        int128 delta,
        int24 currentPoint
    ) private {
        int24 pd = pointDelta;
        Liquidity.Data storage lq = liquidities.get(minter, pl, pr);
        (uint256 mFeeScaleX_128, uint256 mFeeScaleY_128) = (feeScaleX_128, feeScaleY_128);
        bool leftFlipped;
        bool rightFlipped;
        // update points
        if (delta != 0) {
            // add / dec liquidity
            leftFlipped = points.updateEndpoint(pl, true, currentPoint, delta, maxLiquidPt, mFeeScaleX_128, mFeeScaleY_128);
            rightFlipped = points.updateEndpoint(pr, false, currentPoint, delta, maxLiquidPt, mFeeScaleX_128, mFeeScaleY_128);
        }
        // get sub fee scale of the range
        (uint256 subFeeScaleX_128, uint256 subFeeScaleY_128) = 
            points.getSubFeeScale(
                pl, pr, currentPoint, mFeeScaleX_128, mFeeScaleY_128
            );
        lq.update(delta, subFeeScaleX_128, subFeeScaleY_128);
        // update bitmap
        if (leftFlipped) {
            int24 leftVal = getStatusVal(pl, pd);
            if (delta > 0) {
                setStatusVal(pl, pd, leftVal | 1);
                if (leftVal == 0) {
                    pointBitmap.setOne(pl, pd);
                }
            } else {
                int24 newVal = leftVal & 2;
                setStatusVal(pl, pd, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(pl, pd);
                }
                delete points[pl];
            }
        }
        if (rightFlipped) {
            int24 rightVal = getStatusVal(pr, pd);
            if (delta > 0) {
                setStatusVal(pr, pd, rightVal | 1);
                if (rightVal == 0) {
                    pointBitmap.setOne(pr, pd);
                }
            } else {
                int24 newVal = rightVal & 2;
                setStatusVal(pr, pd, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(pr, pd);
                }
                delete points[pr];
            }
        }
    }

    function _computeDepositYc(
        uint128 liquidDelta,
        uint160 sqrtPrice_96
    ) private pure returns (uint128 y) {
        // to simplify computation
        // minter is required to deposit only
        // token y in point of current price
        uint256 amount = MulDivMath.mulDivCeil(
            liquidDelta,
            sqrtPrice_96,
            TwoPower.Pow96
        );
        y = uint128(amount);
        require (y == amount, "YC OFL");
    }

    /// @dev [pl, pr)
    function _computeDepositXY(
        uint128 liquidDelta,
        int24 pl,
        int24 pr,
        State memory st
    ) private view returns (uint128 x, uint128 y, uint128 yc) {
        x = 0;
        uint256 amountY = 0;
        int24 pc = st.currentPoint;
        uint160 sqrtPrice_96 = st.sqrtPrice_96;
        uint160 sqrtPriceR_96 = LogPowMath.getSqrtPrice(pr);
        uint160 _sqrtRate_96 = sqrtRate_96;
        if (pl < pc) {
            uint160 sqrtPriceL_96 = LogPowMath.getSqrtPrice(pl);
            uint256 yl;
            if (pr < pc) {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPriceR_96, _sqrtRate_96, true);
            } else {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPrice_96, _sqrtRate_96, true);
            }
            amountY += yl;
        }
        if (pr > pc) {
            // we need compute XR
            int24 xrLeft = (pl > pc) ? pl : pc + 1;
            uint256 xr = AmountMath.getAmountX(
                liquidDelta,
                xrLeft,
                pr,
                sqrtPriceR_96,
                _sqrtRate_96,
                true
            );
            x = uint128(xr);
            require(x == xr, "XOFL");
        }
        if (pl <= pc && pr > pc) {
            // we nned compute yc at point of current price
            yc = _computeDepositYc(
                liquidDelta,
                sqrtPrice_96
            );
            amountY += yc;
        } else {
            yc = 0;
        }
        y = uint128(amountY);
        require(y == amountY, "YOFL");
    }
    function _computeWithdrawXYAtCurrPt(
        uint128 liquidDelta,
        uint160 sqrtPrice_96,
        uint256 currX,
        uint256 currY
    ) private pure returns (uint256 x, uint256 y) {
        // liquidDelta <= liquidity
        // no need to require(liquidDelta <= liquidity)

        // if only pay token y to minter
        // how many token y are needed
        uint256 amountY = MulDivMath.mulDivFloor(
            liquidDelta,
            sqrtPrice_96,
            TwoPower.Pow96
        );
        // token y is enough to pay
        if (amountY <= currY) {
            x = 0;
            y = uint128(amountY);
        } else {
            y = currY;
            // token x need to payed for rest liquidity
            uint256 liquidY = MulDivMath.mulDivCeil(
                y,
                TwoPower.Pow96,
                sqrtPrice_96
            );

            if (liquidY >= liquidDelta) {
                // no need to pay x
                x = 0;
            } else {
                uint128 liquidX = liquidDelta - uint128(liquidY);
                x = MulDivMath.mulDivFloor(
                    liquidX,
                    TwoPower.Pow96,
                    sqrtPrice_96
                );
                if (x > currX) {
                    x = currX;
                }
            }
        }
    }

    /// @dev [pl, pr)
    function _computeWithdrawXY(
        uint128 liquidDelta,
        int24 pl,
        int24 pr,
        State memory st
    ) private view returns (WithdrawRet memory withRet) {
        uint256 amountY = 0;
        uint256 amountX = 0;
        int24 pc = st.currentPoint;
        uint160 sqrtPrice_96 = st.sqrtPrice_96;
        uint160 sqrtPriceR_96 = LogPowMath.getSqrtPrice(pr);
        uint160 _sqrtRate_96 = sqrtRate_96;
        if (pl < pc) {
            uint160 sqrtPriceL_96 = LogPowMath.getSqrtPrice(pl);
            uint256 yl;
            if (pr < pc) {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPriceR_96, _sqrtRate_96, false);
            } else {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPrice_96, _sqrtRate_96, false);
            }
            amountY += yl;
        }
        if (pr > pc) {
            // we need compute XR
            int24 xrLeft = (pl > pc) ? pl : pc + 1;
            uint256 xr = AmountMath.getAmountX(
                liquidDelta,
                xrLeft,
                pr,
                sqrtPriceR_96,
                _sqrtRate_96,
                false
            );
            amountX += xr;
        }
        if (pl <= pc && pr > pc) {
            if (st.allX) {
                withRet.currY = 0;
                withRet.currX = MulDivMath.mulDivFloor(st.liquidity, TwoPower.Pow96, st.sqrtPrice_96);
            } else {
                withRet.currX = st.currX;
                withRet.currY = st.currY;
            }
            // we nned compute yc at point of current price
            (withRet.xc, withRet.yc) = _computeWithdrawXYAtCurrPt(
                liquidDelta,
                sqrtPrice_96,
                withRet.currX,
                withRet.currY
            );
            withRet.currX -= withRet.xc;
            withRet.currY -= withRet.yc;
            amountY += withRet.yc;
            amountX += withRet.xc;
        } else {
            withRet.yc = 0;
            withRet.xc = 0;
        }
        withRet.y = uint128(amountY);
        require(withRet.y == amountY, "YOFL");
        withRet.x = uint128(amountX);
        require(withRet.x == amountX, "XOFL");
    }
    /// @dev mint
    /// @param minter minter address
    function mint(
        address minter,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta,
        bytes calldata data
    ) external returns (uint128 amountX, uint128 amountY) {
        require(leftPt < rightPt, "LR");
        require(leftPt >= leftMostPt, "LO");
        require(rightPt <= rightMostPt, "HO");
        require(int256(rightPt) - int256(leftPt) < RIGHT_MOST_PT, "TL");
        int24 pd = pointDelta;
        require(leftPt % pd == 0, "LPD");
        require(rightPt % pd == 0, "RPD");
        int128 ld = int128(liquidDelta);
        require(ld > 0, "LP");
        if (minter == address(0)) {
            minter = msg.sender;
        }
        State memory st = state;
        // add a liquidity segment to the pool
        _updateLiquidity(
            minter,
            leftPt,
            rightPt,
            ld,
            st.currentPoint
        );
        // compute amount of tokenx and tokeny should be paid from minter
        (uint128 x, uint128 y, uint128 yc) = _computeDepositXY(
            liquidDelta,
            leftPt,
            rightPt,
            st
        );
        // update state
        if (yc > 0) {
            if (!st.allX) {
                state.currY = st.currY + yc;
            } else {
                state.allX = false;
                state.currX = MulDivMath.mulDivFloor(st.liquidity, TwoPower.Pow96, st.sqrtPrice_96);
                state.currY = yc;
            }
            state.liquidity = st.liquidity + liquidDelta;
        }
        uint256 bx;
        uint256 by;
        if (x > 0) {
            bx = balanceX();
            require(bx + x > bx, "BXO"); // balance x overflow
        }
        if (y > 0) {
            by = balanceY();
            require(by + y > by, "BXO"); // balance y overflow
        }
        if (x > 0 || y > 0) {
            // minter's callback to pay
            IiZiSwapMintCallback(msg.sender).mintDepositCallback(x, y, data);
        }
        if (x > 0) {
            require(bx + x <= balanceX(), "NEX"); // not enough x from minter
        }
        if (y > 0) {
            require(by + y <= balanceY(), "NEY"); // not enough y from minter
        }
        amountX = x;
        amountY = y;
    }

    function burn(
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta
    ) external returns (uint256 amountX, uint256 amountY) {
        // it is not necessary to check leftPt rightPt with [leftMostPt, rightMostPt]
        // because we haved checked it in the mint(...)
        require(leftPt < rightPt, "LR");
        int24 pd = pointDelta;
        require(leftPt % pd == 0, "LPD");
        require(rightPt % pd == 0, "RPD");
        State memory st = state;
        uint128 liquidity = st.liquidity;
        // add a liquidity segment to the pool
        int256 nlDelta = -int256(uint256(liquidDelta));
        require(int128(nlDelta) == nlDelta, "DO");
        _updateLiquidity(
            msg.sender,
            leftPt,
            rightPt,
            int128(nlDelta),
            st.currentPoint
        );
        // compute amount of tokenx and tokeny should be paid from minter
        WithdrawRet memory withRet = _computeWithdrawXY(
            liquidDelta,
            leftPt,
            rightPt,
            st
        );
        // update state
        if (withRet.yc > 0 || withRet.xc > 0) {
            state.liquidity = liquidity - liquidDelta;
            state.allX = (withRet.currY == 0);
            state.currX = withRet.currX;
            state.currY = withRet.currY;
        }
        if (withRet.x > 0 || withRet.y > 0) {
            Liquidity.Data storage lq = liquidities.get(msg.sender, leftPt, rightPt);
            lq.remainFeeX += withRet.x;
            lq.remainFeeY += withRet.y;
        }
        return (withRet.x, withRet.y);
    }

    function collect(
        address recipient,
        int24 leftPt,
        int24 rightPt,
        uint256 amountXLim,
        uint256 amountYLim
    ) external returns (uint256 actualAmountX, uint256 actualAmountY) {
        require(amountXLim > 0 || amountYLim > 0, "X+Y>0");
        Liquidity.Data storage lq = liquidities.get(msg.sender, leftPt, rightPt);
        actualAmountX = amountXLim;
        if (actualAmountX > lq.remainFeeX) {
            actualAmountX = lq.remainFeeX;
        }
        actualAmountY = amountYLim;
        if (actualAmountY > lq.remainFeeY) {
            actualAmountY = lq.remainFeeY;
        }
        lq.remainFeeX -= actualAmountX;
        lq.remainFeeY -= actualAmountY;
        if (actualAmountX > 0) {
            TokenTransfer.transferToken(tokenX, recipient, actualAmountX);
        }
        if (actualAmountY > 0) {
            TokenTransfer.transferToken(tokenY, recipient, actualAmountY);
        }
    }
}