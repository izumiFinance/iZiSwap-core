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

    int24 internal constant LEFT_MOST_PT = -800000;
    int24 internal constant RIGHT_MOST_PT = 800000;

    /// @notice left most point regularized by pointDelta
    int24 public leftMostPt;
    /// @notice right most point regularized by pointDelta
    int24 public rightMostPt;
    /// @notice maximum liquidAcc for each point, see points() in IiZiSwapPool or library Point
    uint128 public maxLiquidPt;

    /// @notice address of iZiSwapFactory
    address public factory;

    /// @notice address of tokenX
    address public tokenX;

    /// @notice address of tokenY
    address public tokenY;

    /// @notice fee amount of this swap pool, 3000 means 0.3%
    uint24 public fee;

    /// @notice minimum number of distance between initialized or limitorder points 
    int24 public pointDelta;

    /// @notice The fee growth as a 128-bit fixpoing fees of tokenX collected per 1 liquidity of the pool
    uint256 public feeScaleX_128;
    /// @notice The fee growth as a 128-bit fixpoing fees of tokenY collected per 1 liquidity of the pool
    uint256 public feeScaleY_128;

    uint160 sqrtRate_96;

    /// @notice some values of pool
    /// see library State or IiZiSwapPool#state for more infomation
    State public state;

    /// @notice the information about a liquidity by the liquidity's key
    mapping(bytes32 =>Liquidity.Data) public liquidities;

    /// @notice 256 packed point (orderOrEndpoint>0) boolean values. See PointBitmap for more information
    mapping(int16 =>uint256) public pointBitmap;

    /// @notice returns infomation of a point in the pool, see Point library of IiZiSwapPool#poitns for more information
    mapping(int24 =>Point.Data) public points;
    /// @notice infomation about a point whether has limit order and whether as an liquidity's endpoint
    mapping(int24 =>int24) public orderOrEndpoint;
    /// @notice limitOrder info on a given point
    mapping(int24 =>LimitOrder.Data) public limitOrderData;
    /// @notice information about a user's limit order (sell tokenY and earn tokenX)
    mapping(bytes32 => UserEarn.Data) public userEarnX;
    /// @notice information about a user's limit order (sell tokenX and earn tokenY)
    mapping(bytes32 => UserEarn.Data) public userEarnY;
    /// @notice observation data array
    Oracle.Observation[65535] public observations;

    address private  original;

    address private swapModuleX2Y;
    address private swapModuleY2X;
    address private mintModule;

    // some data computed if user want to withdraw
    // like refunding tokens after withdraw
    //  or amount of currX or currY at current point after withdraw
    struct WithdrawRet {
        // total amount of tokenX refund after withdraw
        uint256 x;
        // total amount of tokenY refund after withdraw
        uint256 y;
        // amount of refund tokenX at current point after withdraw
        uint256 xc;
        // amount of refund tokenY at current point after withdraw
        uint256 yc;
        // value of currX at current point after withdraw
        uint256 currX;
        // value of currY at current point after withdraw
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

    function getOrderOrEndptVal(int24 point, int24 pd) internal view returns(int24 val) {
        if (point % pd != 0) {
            return 0;
        }
        val = orderOrEndpoint[point / pd];
    }
    function setOrderOrEndptVal(int24 point, int24 pd, int24 val) internal {
        orderOrEndpoint[point / pd] = val;
    }

    /// @dev Add / Dec liquidity of a minter
    /// @param minter the minter of the liquidity
    /// @param leftPoint left endpoint of the segment
    /// @param rightPoint right endpoint of the segment, [leftPoint, rightPoint)
    /// @param delta delta liquidity, positive for adding
    /// @param currentPoint current price point on the axies
    function _updateLiquidity(
        address minter,
        int24 leftPoint,
        int24 rightPoint,
        int128 delta,
        int24 currentPoint
    ) private {
        int24 pd = pointDelta;
        Liquidity.Data storage lq = liquidities.get(minter, leftPoint, rightPoint);
        (uint256 mFeeScaleX_128, uint256 mFeeScaleY_128) = (feeScaleX_128, feeScaleY_128);
        bool leftFlipped;
        bool rightFlipped;
        // update points
        if (delta != 0) {
            // add / dec liquidity
            leftFlipped = points.updateEndpoint(leftPoint, true, currentPoint, delta, maxLiquidPt, mFeeScaleX_128, mFeeScaleY_128);
            rightFlipped = points.updateEndpoint(rightPoint, false, currentPoint, delta, maxLiquidPt, mFeeScaleX_128, mFeeScaleY_128);
        }
        // get sub fee scale of the range
        (uint256 subFeeScaleX_128, uint256 subFeeScaleY_128) = 
            points.getSubFeeScale(
                leftPoint, rightPoint, currentPoint, mFeeScaleX_128, mFeeScaleY_128
            );
        lq.update(delta, subFeeScaleX_128, subFeeScaleY_128);
        // update bitmap
        if (leftFlipped) {
            int24 leftVal = getOrderOrEndptVal(leftPoint, pd);
            if (delta > 0) {
                setOrderOrEndptVal(leftPoint, pd, leftVal | 1);
                if (leftVal == 0) {
                    pointBitmap.setOne(leftPoint, pd);
                }
            } else {
                int24 newVal = leftVal & 2;
                setOrderOrEndptVal(leftPoint, pd, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(leftPoint, pd);
                }
                delete points[leftPoint];
            }
        }
        if (rightFlipped) {
            int24 rightVal = getOrderOrEndptVal(rightPoint, pd);
            if (delta > 0) {
                setOrderOrEndptVal(rightPoint, pd, rightVal | 1);
                if (rightVal == 0) {
                    pointBitmap.setOne(rightPoint, pd);
                }
            } else {
                int24 newVal = rightVal & 2;
                setOrderOrEndptVal(rightPoint, pd, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(rightPoint, pd);
                }
                delete points[rightPoint];
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

    /// @dev [leftPoint, rightPoint)
    function _computeDepositXY(
        uint128 liquidDelta,
        int24 leftPoint,
        int24 rightPoint,
        State memory currentState
    ) private view returns (uint128 x, uint128 y, uint128 yc) {
        x = 0;
        uint256 amountY = 0;
        int24 pc = currentState.currentPoint;
        uint160 sqrtPrice_96 = currentState.sqrtPrice_96;
        uint160 sqrtPriceR_96 = LogPowMath.getSqrtPrice(rightPoint);
        uint160 _sqrtRate_96 = sqrtRate_96;
        if (leftPoint < pc) {
            uint160 sqrtPriceL_96 = LogPowMath.getSqrtPrice(leftPoint);
            uint256 yl;
            if (rightPoint < pc) {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPriceR_96, _sqrtRate_96, true);
            } else {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPrice_96, _sqrtRate_96, true);
            }
            amountY += yl;
        }
        if (rightPoint > pc) {
            // we need compute XR
            int24 xrLeft = (leftPoint > pc) ? leftPoint : pc + 1;
            uint256 xr = AmountMath.getAmountX(
                liquidDelta,
                xrLeft,
                rightPoint,
                sqrtPriceR_96,
                _sqrtRate_96,
                true
            );
            x = uint128(xr);
            require(x == xr, "XOFL");
        }
        if (leftPoint <= pc && rightPoint > pc) {
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

    /// @notice compute some values (refunding tokens, currX or currY values of state) if user wants to withdraw
    /// @param liquidDelta amount of liquidity user wants to withdraw
    /// @param leftPoint left endpoint of liquidity
    /// @param rightPoint right endpoint of liquidity
    /// @param currentState current state values of pool
    /// @return withRet a WithdrawRet struct object containing values computed, see WithdrawRet for more information
    function _computeWithdrawXY(
        uint128 liquidDelta,
        int24 leftPoint,
        int24 rightPoint,
        State memory currentState
    ) private view returns (WithdrawRet memory withRet) {
        uint256 amountY = 0;
        uint256 amountX = 0;
        int24 pc = currentState.currentPoint;
        uint160 sqrtPrice_96 = currentState.sqrtPrice_96;
        uint160 sqrtPriceR_96 = LogPowMath.getSqrtPrice(rightPoint);
        uint160 _sqrtRate_96 = sqrtRate_96;
        if (leftPoint < pc) {
            uint160 sqrtPriceL_96 = LogPowMath.getSqrtPrice(leftPoint);
            uint256 yl;
            if (rightPoint < pc) {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPriceR_96, _sqrtRate_96, false);
            } else {
                yl = AmountMath.getAmountY(liquidDelta, sqrtPriceL_96, sqrtPrice_96, _sqrtRate_96, false);
            }
            amountY += yl;
        }
        if (rightPoint > pc) {
            // we need compute XR
            int24 xrLeft = (leftPoint > pc) ? leftPoint : pc + 1;
            uint256 xr = AmountMath.getAmountX(
                liquidDelta,
                xrLeft,
                rightPoint,
                sqrtPriceR_96,
                _sqrtRate_96,
                false
            );
            amountX += xr;
        }
        if (leftPoint <= pc && rightPoint > pc) {
            if (currentState.allX) {
                withRet.currY = 0;
                withRet.currX = MulDivMath.mulDivFloor(currentState.liquidity, TwoPower.Pow96, currentState.sqrtPrice_96);
            } else {
                withRet.currX = currentState.currX;
                withRet.currY = currentState.currY;
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

    /// @notice add liquidity to the pool
    /// @param recipient Newly created liquidity will belong to this address
    /// @param leftPt left endpoint of the liquidity, be sure to be times of pointDelta
    /// @param rightPt right endpoint of the liquidity, be sure to be times of pointDelta
    /// @param liquidDelta amount of liquidity to add
    /// @param data Any data that should be passed through to the callback
    /// @return amountX The amount of tokenX that was paid for the liquidity. Matches the value in the callback
    /// @return amountY The amount of tokenY that was paid for the liquidity. Matches the value in the callback
    function mint(
        address recipient,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY) {
        require(leftPt < rightPt, "LR");
        require(leftPt >= leftMostPt, "LO");
        require(rightPt <= rightMostPt, "HO");
        require(int256(rightPt) - int256(leftPt) < RIGHT_MOST_PT, "TL");
        int24 pd = pointDelta;
        require(leftPt % pd == 0, "LPD");
        require(rightPt % pd == 0, "RPD");
        int128 ld = int128(liquidDelta);
        require(ld > 0, "LP");
        if (recipient == address(0)) {
            recipient = msg.sender;
        }
        State memory currentState = state;
        // add a liquidity segment to the pool
        _updateLiquidity(
            recipient,
            leftPt,
            rightPt,
            ld,
            currentState.currentPoint
        );
        // compute amount of tokenx and tokeny should be paid from minter
        (uint256 x, uint256 y, uint256 yc) = _computeDepositXY(
            liquidDelta,
            leftPt,
            rightPt,
            currentState
        );
        // update state
        if (yc > 0) {
            if (!currentState.allX) {
                state.currY = currentState.currY + yc;
            } else {
                state.allX = false;
                state.currX = MulDivMath.mulDivFloor(currentState.liquidity, TwoPower.Pow96, currentState.sqrtPrice_96);
                state.currY = yc;
            }
            state.liquidity = currentState.liquidity + liquidDelta;
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

    /// @notice decrease a given amount of liquidity from msg.sender's liquidities
    /// @param leftPt left endpoint of the liquidity
    /// @param rightPt right endpoint of the liquidity
    /// @param liquidDelta amount of liquidity to burn
    /// @return amountX The amount of tokenX should be refund after burn
    /// @return amountY The amount of tokenY should be refund after burn
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
        State memory currentState = state;
        uint128 liquidity = currentState.liquidity;
        // add a liquidity segment to the pool
        int256 nlDelta = -int256(uint256(liquidDelta));
        require(int128(nlDelta) == nlDelta, "DO");
        _updateLiquidity(
            msg.sender,
            leftPt,
            rightPt,
            int128(nlDelta),
            currentState.currentPoint
        );
        // compute amount of tokenx and tokeny should be paid from minter
        WithdrawRet memory withRet = _computeWithdrawXY(
            liquidDelta,
            leftPt,
            rightPt,
            currentState
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

    /// @notice Collects tokens (fee or refunded after burn) from a liquidity
    /// @param recipient The address which should receive the collected tokens
    /// @param leftPt left endpoint of the liquidity
    /// @param rightPt right endpoint of the liquidity
    /// @param amountXLim max amount of tokenX the owner wants to collect
    /// @param amountYLim max amount of tokenY the owner wants to collect
    /// @return actualAmountX The amount tokenX collected
    /// @return actualAmountY The amount tokenY collected
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