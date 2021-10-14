pragma solidity ^0.8.4;

import './interfaces/IIzumiswapPool.sol';
import './libraries/Liquidity.sol';
import './libraries/Point.sol';
import './libraries/PointBitmap.sol';
import './libraries/TickMath.sol';
import './libraries/FullMath.sol';
import './libraries/FixedPoint96.sol';
import './libraries/PointOrder.sol';
import './libraries/SwapMathY2X.sol';
import './libraries/SwapMathX2Y.sol';
import './libraries/SwapMathY2XDesire.sol';
import './libraries/SwapMathX2YDesire.sol';
import './libraries/UserEarn.sol';
import './libraries/TransferHelper.sol';
import './libraries/State.sol';
import './interfaces/IIzumiswapCallback.sol';

contract IzumiswapPool is IIzumiswapPool {

    // TODO following usings may need modify
    using Liquidity for mapping(bytes32 =>Liquidity.Data);
    using Liquidity for Liquidity.Data;
    using Point for mapping(int24 =>Point.Data);
    using Point for Point.Data;
    using PointBitmap for mapping(int16 =>uint256);
    using PointOrder for PointOrder.Data;
    using UserEarn for UserEarn.Data;
    using UserEarn for mapping(bytes32 =>UserEarn.Data);
    using SwapMathY2X for SwapMathY2X.RangeRetState;
    using SwapMathX2Y for SwapMathX2Y.RangeRetState;

    // TODO following values need change
    int24 internal constant LEFT_MOST_PT = -800000;
    int24 internal constant RIGHT_MOST_PT = 800000;

    int24 private leftMostPt;
    int24 private rightMostPt;
    uint128 private maxLiquidPt;

    address public immutable factory;
    address public immutable tokenX;
    address public immutable tokenY;
    uint24 public immutable fee;
    int24 public immutable ptDelta;

    uint256 public feeScaleX_128;
    uint256 public feeScaleY_128;

    uint160 private sqrtRate_96;

    // struct State {
    //     uint160 sqrtPrice_96;
    //     int24 currPt;
    //     uint256 currX;
    //     uint256 currY;
    //     // liquidity from currPt to right
    //     uint128 liquidity;
    //     bool allX;
    //     bool locked;
    // }
    State public override state;

    struct Cache {
        uint256 currFeeScaleX_128;
        uint256 currFeeScaleY_128;
        bool finished;
        uint160 _sqrtRate_96;
        int24 pd;
        int24 currVal;
    }
    struct WithdrawRet {
        uint256 x;
        uint256 y;
        uint256 xc;
        uint256 yc;
        uint256 currX;
        uint256 currY;
    }

    /// TODO: following mappings may need modify
    mapping(bytes32 =>Liquidity.Data) public override liquidities;
    mapping(int16 =>uint256) pointBitmap;
    mapping(int24 =>Point.Data) points;
    mapping(int24 =>int24) public override statusVal;
    mapping(int24 =>PointOrder.Data) public override limitOrderData;
    mapping(bytes32 => UserEarn.Data) userEarnX;
    mapping(bytes32 => UserEarn.Data) userEarnY;

    modifier lock() {
        require(!state.locked, 'LKD');
        state.locked = true;
        _;
        state.locked = false;
    }

    function _setRange(int24 pd) private {
        rightMostPt = RIGHT_MOST_PT / pd * pd;
        leftMostPt = - rightMostPt;
        int32 ptNum = (int32(rightMostPt) - int32(leftMostPt)) / pd;
        maxLiquidPt = type(uint128).max / uint32(ptNum);
    }

    constructor(
        address fac,
        address tX,
        address tY,
        uint24 swapFee,
        int24 cp,
        int24 pd
    ) public {
        require(pd > 1);
        factory = fac;
        tokenX = tX;
        tokenY = tY;
        fee = swapFee;
        ptDelta = pd;
        _setRange(pd);

        // current state
        state.currPt = cp;
        state.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(cp);
        state.liquidity = 0;
        state.allX = true;
        state.currX = 0;
        state.currY = 0;
        state.locked = false;

        sqrtRate_96 = TickMath.getSqrtRatioAtTick(1);
    }

    /// @dev Add / Dec liquidity of a minter
    /// @param minter the minter of the liquidity
    /// @param pl left endpt of the segment
    /// @param pr right endpt of the segment, [pl, pr)
    /// @param delta delta liquidity, positive for adding
    /// @param currPoint current price point on the axies
    function _updateLiquidity(
        address minter,
        int24 pl,
        int24 pr,
        int128 delta,
        int24 currPoint
    ) private {
        int24 pd = ptDelta;
        Liquidity.Data storage lq = liquidities.get(minter, pl, pr);
        (uint256 mFeeScaleX_128, uint256 mFeeScaleY_128) = (feeScaleX_128, feeScaleY_128);
        bool leftFlipped;
        bool rightFlipped;
        // update points
        if (delta != 0) {
            // add / dec liquidity
            leftFlipped = points.updateEndpt(pl, true, currPoint, delta, maxLiquidPt, mFeeScaleX_128, mFeeScaleY_128);
            rightFlipped = points.updateEndpt(pr, false, currPoint, delta, maxLiquidPt, mFeeScaleX_128, mFeeScaleY_128);
        }
        // get sub fee scale of the range
        (uint256 subFeeScaleX_128, uint256 subFeeScaleY_128) = 
            points.getSubFeeScale(
                pl, pr, currPoint, mFeeScaleX_128, mFeeScaleY_128
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
        uint256 amount = FullMath.mulDivRoundingUp(
            liquidDelta,
            sqrtPrice_96,
            FixedPoint96.Q96
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
        int24 pc = st.currPt;
        uint160 sqrtPrice_96 = st.sqrtPrice_96;
        uint160 sqrtPriceR_96 = TickMath.getSqrtRatioAtTick(pr);
        uint160 _sqrtRate_96 = sqrtRate_96;
        if (pl < pc) {
            uint160 sqrtPriceL_96 = TickMath.getSqrtRatioAtTick(pl);
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
        uint128 liquidity,
        uint128 liquidDelta,
        uint160 sqrtPrice_96,
        uint256 currX,
        uint256 currY
    ) private pure returns (uint256 x, uint256 y) {
        // liquidDelta <= liquidity
        // no need to require(liquidDelta <= liquidity)

        // if only pay token y to minter
        // how many token y are needed
        uint256 amountY = FullMath.mulDiv(
            liquidDelta,
            sqrtPrice_96,
            FixedPoint96.Q96
        );
        // token y is enough to pay
        if (amountY <= currY) {
            x = 0;
            y = uint128(amountY);
        } else {
            y = currY;
            // token x need to payed for rest liquidity
            uint256 liquidY = FullMath.mulDivRoundingUp(
                y,
                FixedPoint96.Q96,
                sqrtPrice_96
            );

            if (liquidY >= liquidDelta) {
                // no need to pay x
                x = 0;
            } else {
                uint128 liquidX = liquidDelta - uint128(liquidY);
                x = FullMath.mulDiv(
                    liquidX,
                    FixedPoint96.Q96,
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
        int24 pc = st.currPt;
        uint160 sqrtPrice_96 = st.sqrtPrice_96;
        uint160 sqrtPriceR_96 = TickMath.getSqrtRatioAtTick(pr);
        uint160 _sqrtRate_96 = sqrtRate_96;
        if (pl < pc) {
            uint160 sqrtPriceL_96 = TickMath.getSqrtRatioAtTick(pl);
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
            amountY += xr;
        }
        if (pl <= pc && pr > pc) {
            if (st.allX) {
                withRet.currY = 0;
                withRet.currX = FullMath.mulDiv(st.liquidity, FixedPoint96.Q96, st.sqrtPrice_96);
            } else {
                withRet.currX = st.currX;
                withRet.currY = st.currY;
            }
            // we nned compute yc at point of current price
            (withRet.xc, withRet.yc) = _computeWithdrawXYAtCurrPt(
                st.liquidity,
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
    function decLimOrderWithX(
        address recipient,
        int24 pt,
        uint128 deltaX,
        uint128 acquireYLim
    ) external override lock returns (uint128 actualDeltaX, uint256 acquireY) {
        require(pt % ptDelta == 0, "PD");
        require(pt >= state.currPt, "PG");

        UserEarn.Data storage ue = userEarnY.get(msg.sender, pt);
        PointOrder.Data storage pointOrder = limitOrderData[pt];
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        (actualDeltaX, pointOrder.earnY) = ue.dec(deltaX, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnY, true);
        pointOrder.sellingX -= actualDeltaX;
        acquireY = acquireYLim;
        if (acquireY > ue.earn) {
            acquireY = ue.earn;
        }
        ue.earn -= acquireY;
        
        if (actualDeltaX > 0 && pointOrder.sellingX == 0) {
            int24 newVal = getStatusVal(pt, ptDelta) & 1;
            setStatusVal(pt, ptDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(pt, ptDelta);
            }
        }

        if (actualDeltaX > 0) {
            TransferHelper.safeTransfer(tokenX, recipient, actualDeltaX);
        }

        if (acquireY > 0) {
            TransferHelper.safeTransfer(tokenY, recipient, acquireY);
        }

    }

    function decLimOrderWithY(
        address recipient,
        int24 pt,
        uint128 deltaY,
        uint128 acquireXLim
    ) external override lock returns (uint128 actualDeltaY, uint256 acquireX) {
        require(pt % ptDelta == 0, "PD");
        require(pt <= state.currPt, "PL");

        UserEarn.Data storage ue = userEarnX.get(msg.sender, pt);
        PointOrder.Data storage pointOrder = limitOrderData[pt];
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        (actualDeltaY, pointOrder.earnX) = ue.dec(deltaY, pointOrder.accEarnX, sqrtPrice_96, pointOrder.earnX, false);
        pointOrder.sellingY -= actualDeltaY;
        acquireX = acquireXLim;
        if (acquireX > ue.earn) {
            acquireX = ue.earn;
        }
        ue.earn -= acquireX;
        
        if (actualDeltaY > 0 && pointOrder.sellingY == 0) {
            int24 newVal = getStatusVal(pt, ptDelta) & 1;
            setStatusVal(pt, ptDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(pt, ptDelta);
            }
        }

        if (actualDeltaY > 0) {
            TransferHelper.safeTransfer(tokenY, recipient, actualDeltaY);
        }

        if (acquireX > 0) {
            TransferHelper.safeTransfer(tokenX, recipient, acquireX);
        }

    }

    function addLimOrderWithX(
        address recipient,
        int24 pt,
        uint128 amountX
    ) external override lock returns (uint128 orderX, uint256 acquireY) {
        require(pt % ptDelta == 0, "PD");
        require(pt >= state.currPt, "PG");
        require(amountX > 0, "XP");

        // update point order
        PointOrder.Data storage pointOrder = limitOrderData[pt];

        orderX = amountX;
        acquireY = 0;
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        uint256 currY = pointOrder.sellingY;
        uint256 currX = pointOrder.sellingX;
        if (currY > 0) {
            uint128 costX;
            (costX, acquireY) = SwapMathX2Y.x2YAtPriceLiquidity(amountX, sqrtPrice_96, currY);
            orderX -= costX;
            currY -= acquireY;
            pointOrder.accEarnX = pointOrder.accEarnX + costX;
            pointOrder.earnX = pointOrder.earnX + costX;
            pointOrder.sellingY = currY;
        }
        if (orderX > 0) {
            currX += orderX;
            pointOrder.sellingX = currX;
            UserEarn.Data storage ue = userEarnY.get(msg.sender, pt);
            pointOrder.earnY = ue.add(orderX, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnY, true);
        }
        // update statusval and bitmap
        if (currX == 0 && currY == 0) {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                setStatusVal(pt, ptDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(pt, ptDelta);
                }
            }
        } else {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                setStatusVal(pt, ptDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(pt, ptDelta);
                }
            }
        }

        if (acquireY > 0) {
            // pay y to recipient
            TransferHelper.safeTransfer(tokenY, recipient, acquireY);
        }
        // trader pay x
        uint256 bx = balanceX();
        IIzumiswapAddLimOrderCallback(msg.sender).payCallback(tokenX, recipient, amountX);
        require(balanceX() >= bx + amountX, "XE");

    }
    
    function addLimOrderWithY(
        address recipient,
        int24 pt,
        uint128 amountY
    ) external override lock returns (uint128 orderY, uint256 acquireX) {
        require(pt % ptDelta == 0, "PD");
        require(pt <= state.currPt, "PL");
        require(amountY > 0, "YP");

        // update point order
        PointOrder.Data storage pointOrder = limitOrderData[pt];

        orderY = amountY;
        acquireX = 0;
        uint160 sqrtPrice_96 = TickMath.getSqrtRatioAtTick(pt);
        uint256 currY = pointOrder.sellingY;
        uint256 currX = pointOrder.sellingX;
        if (currX > 0) {
            uint128 costY;
            (costY, acquireX) = SwapMathY2X.y2XAtPriceLiquidity(amountY, sqrtPrice_96, currX);
            orderY -= costY;
            currX -= acquireX;
            pointOrder.accEarnY = pointOrder.accEarnY + costY;
            pointOrder.earnY = pointOrder.earnY + costY;
            pointOrder.sellingX = currX;
        }
        if (orderY > 0) {
            currY += orderY;
            pointOrder.sellingY = currY;
            UserEarn.Data storage ue = userEarnX.get(msg.sender, pt);
            pointOrder.earnX = ue.add(orderY, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnX, false);
        }
        // update statusval and bitmap
        if (currX == 0 && currY == 0) {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                setStatusVal(pt, ptDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(pt, ptDelta);
                }
            }
        } else {
            int24 val = getStatusVal(pt, ptDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                setStatusVal(pt, ptDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(pt, ptDelta);
                }
            }
        }

        if (acquireX > 0) {
            // pay x to recipient
            TransferHelper.safeTransfer(tokenX, recipient, acquireX);
        }
        // trader pay y
        uint256 by = balanceY();
        IIzumiswapAddLimOrderCallback(msg.sender).payCallback(tokenY, recipient, amountY);
        require(balanceY() >= by + amountY, "YE");

    }

    /// @dev mint
    /// @param minter minter address
    function mint(
        address minter,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta,
        bytes calldata data
    ) external override lock returns (uint128 amountX, uint128 amountY) {
        require(leftPt < rightPt, "LR");
        int24 pd = ptDelta;
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
            st.currPt
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
                state.currX = FullMath.mulDiv(st.liquidity, FixedPoint96.Q96, st.sqrtPrice_96);
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
            IIzumiswapMintCallback(msg.sender).mintDepositCallback(x, y, data);
        }
        if (x > 0) {
            require(bx + x <= balanceX(), "NEX"); // not enough x from minter
        }
        if (y > 0) {
            require(by + y <= balanceY(), "NEY"); // not enough y from minter
        }
    }

    function burn(
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta
    ) external override lock returns (uint256 amountX, uint256 amountY) {
        require(liquidDelta > 0, "LP");
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
            st.currPt
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
    ) external override lock returns (uint256 actualAmountX, uint256 actualAmountY) {
        require(amountXLim > 0, "XLP");
        require(amountYLim > 0, "YLP");
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
            TransferHelper.safeTransfer(tokenX, recipient, actualAmountX);
        }
        if (actualAmountY > 0) {
            TransferHelper.safeTransfer(tokenY, recipient, actualAmountY);
        }
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

    /// @dev swap pay tokeny and buy token x
    /// @param recipient address of actual trader
    /// @param amount amount of y to pay from trader
    /// @param highPt point of highest price of x
    /// @param data calldata for user's callback to transfer y
    /// @return amountX amountY token x trader actually acquired and token y trader actually paid
    function swapY2X(
        address recipient,
        uint128 amount,
        int24 highPt,
        bytes calldata data
    ) external override lock returns (uint256 amountX, uint256 amountY) {
        // todo we will consider -amount of desired x later
        require(amount > 0, "AP");
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = ptDelta;
        cache.currVal = getStatusVal(st.currPt, cache.pd);
        while (st.currPt < highPt && !cache.finished) {

            if (cache.currVal & 2 > 0) {
                // clear limit order first
                PointOrder.Data storage od = limitOrderData[st.currPt];
                uint256 currX = od.sellingX;
                (uint128 costY, uint256 acquireX) = SwapMathY2X.y2XAtPriceLiquidity(
                    amount, st.sqrtPrice_96, currX
                );
                if (acquireX < currX || costY >= amount) {
                    cache.finished = true;
                }
                amount -= costY;
                amountY = amountY + costY;
                amountX += acquireX;
                currX -= acquireX;
                od.sellingX = currX;
                od.earnY += costY;
                od.accEarnY += costY;
                if (od.sellingY == 0 && currX == 0) {
                    int24 newVal = cache.currVal & 1;
                    setStatusVal(st.currPt, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currPt, cache.pd);
                    }
                }
            }

            if (cache.finished) {
                break;
            }

            (int24 nextPt, bool inited) = pointBitmap.nextInitializedpointWithinOneWord(st.currPt, cache.pd, false);
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            if (nextPt > highPt) {
                nextVal = 0;
                nextPt = highPt;
            }
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [st.currPoint, nextPt)
                st.currPt = nextPt;
                st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                st.allX = true;
                if (nextVal & 1 > 0) {
                    Point.Data storage endPt = points[nextPt];
                    // pass next point from left to right
                    endPt.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    // we should add delta liquid of nextPt
                    int128 liquidDelta = endPt.liquidDelta;
                    st.liquidity = LiquidityMath.addDelta(st.liquidity, liquidDelta);
                }
                cache.currVal = nextVal;
            } else {
                // amount > 0
                uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
                if (amountNoFee > 0) {
                    SwapMathY2X.RangeRetState memory retState = SwapMathY2X.y2XRange(
                        st, nextPt, cache._sqrtRate_96, amountNoFee
                    );
                    cache.finished = retState.finished;
                    uint128 feeAmount;
                    if (retState.costY >= amountNoFee) {
                        feeAmount = amount - retState.costY;
                    } else {
                        feeAmount = uint128(uint256(retState.costY) * fee / 1e6);
                        uint256 mod = uint256(retState.costY) * fee % 1e6;
                        if (mod > 0) {
                            feeAmount += 1;
                        }
                    }

                    amountX += retState.acquireX;
                    amountY = amountY + retState.costY + feeAmount;
                    amount -= (retState.costY + feeAmount);
                    
                    cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                } else {
                    cache.finished = true;
                }
                if (st.currPt == nextPt && (nextVal & 1) > 0) {
                    Point.Data storage endPt = points[nextPt];
                    // pass next point from left to right
                    endPt.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    st.liquidity = LiquidityMath.addDelta(st.liquidity, endPt.liquidDelta);
                }
                if (st.currPt == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
        }
        // write back fee scale, no fee of x
        feeScaleY_128 = cache.currFeeScaleY_128;
        // write back state
        state = st;
        // transfer x to trader
        if (amountX > 0) {
            TransferHelper.safeTransfer(tokenX, recipient, amountX);
            // trader pay y
            require(amountY > 0, "PP");
            uint256 by = balanceY();
            IIzumiswapSwapCallback(msg.sender).swapY2XCallback(amountY, data);
            require(balanceY() >= by + amountY, "YE");
        }
    }

    function swapY2XDesireX(
        address recipient,
        uint128 desireX,
        int24 highPt,
        bytes calldata data
    ) external override lock returns (uint256 amountX, uint256 amountY) {
        require (desireX > 0, "XP");
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = ptDelta;
        cache.currVal = getStatusVal(st.currPt, cache.pd);
        while (st.currPt < highPt && !cache.finished) {
            if (cache.currVal & 2 > 0) {
                // clear limit order first
                PointOrder.Data storage od = limitOrderData[st.currPt];
                uint256 currX = od.sellingX;
                (uint256 costY, uint128 acquireX) = SwapMathY2XDesire.y2XAtPriceLiquidity(
                    desireX, st.sqrtPrice_96, currX
                );
                if (acquireX >= desireX) {
                    cache.finished = true;
                }
                desireX = (desireX <= acquireX) ? 0 : desireX - acquireX;
                amountY += costY;
                amountX += acquireX;
                currX -= acquireX;
                od.sellingX = currX;
                od.earnY += costY;
                od.accEarnY += costY;
                if (od.sellingY == 0 && currX == 0) {
                    int24 newVal = cache.currVal & 1;
                    setStatusVal(st.currPt, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currPt, cache.pd);
                    }
                }
            }

            if (cache.finished) {
                break;
            }
            (int24 nextPt, bool inited) = pointBitmap.nextInitializedpointWithinOneWord(st.currPt, cache.pd, false);
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            if (nextPt > highPt) {
                nextVal = 0;
                nextPt = highPt;
            }
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [st.currPoint, nextPt)
                st.currPt = nextPt;
                st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                st.allX = true;
                if (nextVal & 1 > 0) {
                    Point.Data storage endPt = points[nextPt];
                    // pass next point from left to right
                    endPt.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    // we should add delta liquid of nextPt
                    int128 liquidDelta = endPt.liquidDelta;
                    st.liquidity = LiquidityMath.addDelta(st.liquidity, liquidDelta);
                }
                cache.currVal = nextVal;
            } else {
                // desireX > 0
                if (desireX > 0) {
                    SwapMathY2XDesire.RangeRetState memory retState = SwapMathY2XDesire.y2XRange(
                        st, nextPt, cache._sqrtRate_96, desireX
                    );
                    cache.finished = retState.finished;
                    uint256 feeAmount = FullMath.mulDivRoundingUp(retState.costY, fee, 1e6);
                    console.log("actual costY without fee: %s", retState.costY);
                    console.log("actual acquireX : %s", retState.acquireX);


                    amountX += retState.acquireX;
                    amountY += (retState.costY + feeAmount);
                    desireX = (desireX <= retState.acquireX) ? 0 : desireX - uint128(retState.acquireX);
                    
                    cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                } else {
                    cache.finished = true;
                }
                if (st.currPt == nextPt && (nextVal & 1) > 0) {
                    Point.Data storage endPt = points[nextPt];
                    // pass next point from left to right
                    endPt.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                    st.liquidity = LiquidityMath.addDelta(st.liquidity, endPt.liquidDelta);
                }
                if (st.currPt == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
        }
        // write back fee scale, no fee of x
        feeScaleY_128 = cache.currFeeScaleY_128;
        // write back state
        state = st;
        // transfer x to trader
        if (amountX > 0) {
            TransferHelper.safeTransfer(tokenX, recipient, amountX);
            // trader pay y
            require(amountY > 0, "PP");
            uint256 by = balanceY();
            IIzumiswapSwapCallback(msg.sender).swapY2XCallback(amountY, data);
            require(balanceY() >= by + amountY, "YE");
        }
    }

    function getStatusVal(int24 pt, int24 pd) internal view returns(int24 val) {
        if (pt % pd != 0) {
            return 0;
        }
        val = statusVal[pt / pd];
    }
    function setStatusVal(int24 pt, int24 pd, int24 val) internal {
        statusVal[pt / pd] = val;
    }

    /// @dev swap sell tokenx and buy y
    /// @param recipient address of actual trader
    /// @param amount amount of x to sell from trader
    /// @param lowPt point of lowest price of y
    /// @param data calldata for user's callback to transfer x
    /// @return amountX amountY token x trader actually sale and token y trader actually acquired
    function swapX2Y(
        address recipient,
        uint128 amount,
        int24 lowPt,
        bytes calldata data
    ) external override lock returns (uint256 amountX, uint256 amountY) {
        // todo we will consider -amount of desired y later
        require(amount > 0, "AP");
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = ptDelta;
        cache.currVal = getStatusVal(st.currPt, cache.pd);
        while (lowPt <= st.currPt && !cache.finished) {
            // clear limit order first
            if (cache.currVal & 2 > 0) {
                PointOrder.Data storage od = limitOrderData[st.currPt];
                uint256 currY = od.sellingY;
                (uint128 costX, uint256 acquireY) = SwapMathX2Y.x2YAtPriceLiquidity(
                    amount, st.sqrtPrice_96, currY
                );
                if (acquireY < currY || costX >= amount) {
                    cache.finished = true;
                }
                amount -= costX;
                amountX = amountX + costX;
                amountY += acquireY;
                currY -= acquireY;
                od.sellingY = currY;
                od.earnX += costX;
                od.accEarnX += costX;
                if (od.sellingX == 0 && currY == 0) {
                    int24 newVal = cache.currVal & 1;
                    setStatusVal(st.currPt, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currPt, cache.pd);
                    }
                }
            }
            if (cache.finished) {
                break;
            }
            int24 searchStart = st.currPt - 1;
            // second, clear the liquid if the currPt is an endpt
            if (cache.currVal & 1 > 0) {
                uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
                if (amountNoFee > 0) {
                    SwapMathX2Y.RangeRetState memory retState = SwapMathX2Y.x2YRange(
                        st,
                        st.currPt,
                        cache._sqrtRate_96,
                        amountNoFee
                    );
                    cache.finished = retState.finished;
                    uint128 feeAmount;
                    if (retState.costX >= amountNoFee) {
                        feeAmount = amount - retState.costX;
                    } else {
                        feeAmount = uint128(uint256(retState.costX) * fee / 1e6);
                        uint256 mod = uint256(retState.costX) * fee % 1e6;
                        if (mod > 0) {
                            feeAmount += 1;
                        }
                    }
                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);
                    amountX = amountX + retState.costX + feeAmount;
                    amountY += retState.acquireY;
                    amount -= (retState.costX + feeAmount);
                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                    if (!cache.finished) {
                        Point.Data storage ptdata = points[st.currPt];
                        ptdata.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                        st.liquidity = LiquidityMath.addDelta(st.liquidity, - ptdata.liquidDelta);
                        st.currPt = st.currPt - 1;
                        st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                        st.allX = false;
                        st.currX = 0;
                        st.currY = FullMath.mulDiv(st.liquidity, st.sqrtPrice_96, FixedPoint96.Q96);
                    }
                } else {
                    cache.finished = true;
                }
            }
            if (cache.finished || st.currPt < lowPt) {
                break;
            }
            (int24 nextPt, bool inited) = pointBitmap.nextInitializedpointWithinOneWord(searchStart, cache.pd, true);
            if (nextPt < lowPt) {
                nextPt = lowPt;
            }
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [nextPt, st.currPt]
                st.currPt = nextPt;
                st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                st.allX = true;
                cache.currVal = nextVal;
            } else {
                // amount > 0
                uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
                if (amountNoFee > 0) {
                    SwapMathX2Y.RangeRetState memory retState = SwapMathX2Y.x2YRange(
                        st, nextPt, cache._sqrtRate_96, amountNoFee
                    );
                    cache.finished = retState.finished;
                    uint128 feeAmount;
                    if (retState.costX >= amountNoFee) {
                        feeAmount = amount - retState.costX;
                    } else {
                        feeAmount = uint128(uint256(retState.costX) * fee / 1e6);
                        uint256 mod = uint256(retState.costX) * fee % 1e6;
                        if (mod > 0) {
                            feeAmount += 1;
                        }
                    }

                    amountY += retState.acquireY;
                    amountX = amountX + retState.costX + feeAmount;
                    amount -= (retState.costX + feeAmount);
                    
                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                } else {
                    cache.finished = true;
                }
                if (st.currPt == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
        }

        // write back fee scale, no fee of y
        feeScaleX_128 = cache.currFeeScaleX_128;
        // write back state
        state = st;
        // transfer y to trader
        if (amountY > 0) {
            TransferHelper.safeTransfer(tokenY, recipient, amountY);
            // trader pay x
            require(amountX > 0, "PP");
            uint256 bx = balanceX();
            IIzumiswapSwapCallback(msg.sender).swapX2YCallback(amountX, data);
            require(balanceX() >= bx + amountX, "XE");
        }
    }

    // function swapX2Y(
    //     address recipient,
    //     uint128 amount,
    //     int24 lowPt,
    //     bytes calldata data
    // ) external override lock returns (uint128 amountX, uint256 amountY) {
    //     // todo we will consider -amount of desired y later
    //     require(amount > 0, "AP");
    //     amountX = 0;
    //     amountY = 0;
    //     State memory st = state;
    //     Cache memory cache;
    //     cache.currFeeScaleX_128 = feeScaleX_128;
    //     cache.currFeeScaleY_128 = feeScaleY_128;
    //     cache.finished = false;
    //     cache._sqrtRate_96 = sqrtRate_96;
    //     cache.pd = ptDelta;
    //     while (lowPt <= st.currPt && !cache.finished) {
    //         (int24 nextPt, bool inited) = pointBitmap.nextInitializedpointWithinOneWord(st.currPt, cache.pd, true);
    //         cache.currVal = getStatusVal(nextPt, cache.pd);
    //         if (nextPt == st.currPt) {
    //             if (cache.currVal & 2 > 0) {
    //                 // clear limit order first
    //                 PointOrder.Data storage od = limitOrderData[st.currPt];
    //                 uint256 currY = od.sellingY;
    //                 (uint128 costX, uint256 acquireY) = SwapMathX2Y.x2YAtPriceLiquidity(
    //                     amount, st.sqrtPrice_96, currY
    //                 );
    //                 if (acquireY < currY || costX >= amount) {
    //                     cache.finished = true;
    //                 }
    //                 amount -= costX;
    //                 amountX += costX;
    //                 amountY += acquireY;
    //                 currY -= acquireY;
    //                 od.sellingY = currY;
    //                 od.earnX += costX;
    //                 od.accEarnX += costX;
    //                 if (od.sellingX == 0 && currY == 0) {
    //                     int24 newVal = cache.currVal & 1;
    //                     setStatusVal(st.currPt, cache.pd, newVal);
    //                     if (newVal == 0) {
    //                         pointBitmap.setZero(st.currPt, cache.pd);
    //                     }
    //                 }
    //             }
    //             if (!cache.finished) {
    //                 // liquid order at curr point
    //                 uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));

    //                 if (amountNoFee > 0) {
    //                     SwapMathX2Y.RangeRetState memory retState = SwapMathX2Y.x2YRange(
    //                         st,
    //                         nextPt,
    //                         cache._sqrtRate_96,
    //                         amountNoFee
    //                     );
    //                     cache.finished = retState.finished;
    //                     uint128 feeAmount;
    //                     if (retState.costX >= amountNoFee) {
    //                         feeAmount = amount - retState.costX;
    //                     } else {
    //                         feeAmount = uint128(uint256(retState.costX) * fee / 1e6);
    //                         uint256 mod = uint256(retState.costX) * fee % 1e6;
    //                         if (mod > 0) {
    //                             feeAmount += 1;
    //                         }
    //                     }

    //                     cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

    //                     amountX += (retState.costX + feeAmount);
    //                     amountY += retState.acquireY;
    //                     amount -= (retState.costX + feeAmount);
    //                     st.currPt = retState.finalPt;
    //                     st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
    //                     st.allX = retState.finalAllX;
    //                     st.currX = retState.finalCurrX;
    //                     st.currY = retState.finalCurrY;
                        
    //                 } else {
    //                     cache.finished = true;
    //                 }
    //             }
    //             if (!cache.finished) {
    //                 // must move to left
    //                 if (cache.currVal & 1 > 0) {
    //                     Point.Data storage ptdata = points[st.currPt];
    //                     ptdata.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
    //                     st.liquidity = LiquidityMath.addDelta(st.liquidity, - ptdata.liquidDelta);
    //                 }
    //                 st.currPt = st.currPt - 1;
    //                 st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
    //                 st.allX = false;
    //                 st.currX = 0;
    //                 st.currY = FullMath.mulDiv(st.liquidity, st.sqrtPrice_96, FixedPoint96.Q96);
    //             }
    //         } else {
    //             // nextPt < currPt
    //             int24 leftPt = nextPt;
    //             if (cache.currVal & 2 > 0) {
    //                 leftPt += 1;
    //             }
    //             if (leftPt < lowPt) {
    //                 leftPt = lowPt;
    //             }
    //             uint128 amountNoFee = uint128(uint256(amount) * 1e6 / (1e6 + fee));
    //             if (amountNoFee > 0) {
    //                 SwapMathX2Y.RangeRetState memory retState = SwapMathX2Y.x2YRange(
    //                     st,
    //                     leftPt,
    //                     cache._sqrtRate_96,
    //                     amountNoFee
    //                 );
    //                 cache.finished = retState.finished;

    //                 uint128 feeAmount;
    //                 if (retState.costX >= amountNoFee) {
    //                     feeAmount = amount - retState.costX;
    //                 } else {
    //                     feeAmount = uint128(uint256(retState.costX) * fee / 1e6);
    //                     uint256 mod = uint256(retState.costX) * fee % 1e6;
    //                     if (mod > 0) {
    //                         feeAmount += 1;
    //                     }
    //                 }

    //                 cache.currFeeScaleY_128 = cache.currFeeScaleY_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

    //                 amountX += (retState.costX + feeAmount);
    //                 amountY += retState.acquireY;
    //                 amount -= (retState.costX + feeAmount);
    //                 st.currPt = retState.finalPt;
    //                 st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
    //                 st.allX = retState.finalAllX;
    //                 st.currX = retState.finalCurrX;
    //                 st.currY = retState.finalCurrY;
    //             } else {
    //                 cache.finished = true;
    //             }
    //             if (!cache.finished && leftPt > nextPt) {
    //                 // move to left
    //                 // it is believed that st.currPt == leftPt now and st.allX is true
    //                 // it is also believed that [leftPt - 1, st.currPt) has no endpt

    //                 st.currPt = leftPt - 1;
    //                 st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
    //                 st.allX = false;
    //                 st.currX = 0;
    //                 st.currY = FullMath.mulDiv(st.liquidity, st.sqrtPrice_96, FixedPoint96.Q96); 
    //             }
    //         }
    //     }

    //     // write back fee scale, no fee of y
    //     feeScaleX_128 = cache.currFeeScaleX_128;
    //     // write back state
    //     state = st;
    //     // transfer y to trader
    //     if (amountY > 0) {
    //         TransferHelper.safeTransfer(tokenY, recipient, amountY);
    //         // trader pay x
    //         require(amountX > 0, "PP");
    //         uint256 bx = balanceX();
    //         IIzumiswapSwapCallback(msg.sender).swapX2YCallback(amountX, data);
    //         require(balanceX() >= bx + amountX, "XE");
    //     }
    // }
    function findLeft(int24 searchStart, int24 pd) private view returns (int24 nextPt) {
        bool inited;
        ( nextPt,  inited) = pointBitmap.nextInitializedpointWithinOneWord(searchStart, pd, true);
    }
    function swapX2YDesireY(
        address recipient,
        uint128 desireY,
        int24 lowPt,
        bytes calldata data
    ) external override lock returns (uint256 amountX, uint256 amountY) {
        // todo we will consider -amount of desired y later
        require(desireY > 0, "AP");
        amountX = 0;
        amountY = 0;
        State memory st = state;
        Cache memory cache;
        cache.currFeeScaleX_128 = feeScaleX_128;
        cache.currFeeScaleY_128 = feeScaleY_128;
        cache.finished = false;
        cache._sqrtRate_96 = sqrtRate_96;
        cache.pd = ptDelta;
        cache.currVal = getStatusVal(st.currPt, cache.pd);
        while (lowPt <= st.currPt && !cache.finished) {
            // clear limit order first
            if (cache.currVal & 2 > 0) {
                PointOrder.Data storage od = limitOrderData[st.currPt];
                uint256 currY = od.sellingY;
                (uint256 costX, uint256 acquireY) = SwapMathX2YDesire.x2YAtPriceLiquidity(
                    desireY, st.sqrtPrice_96, currY
                );
                if (acquireY >= desireY) {
                    cache.finished = true;
                }
                desireY = (desireY <= acquireY) ? 0 : desireY - uint128(acquireY);
                amountX += costX;
                amountY += acquireY;
                currY -= acquireY;
                od.sellingY = currY;
                od.earnX += costX;
                od.accEarnX += costX;
                if (od.sellingX == 0 && currY == 0) {
                    int24 newVal = cache.currVal & 1;
                    setStatusVal(st.currPt, cache.pd, newVal);
                    if (newVal == 0) {
                        pointBitmap.setZero(st.currPt, cache.pd);
                    }
                }
            }
            if (cache.finished) {
                break;
            }
            int24 searchStart = st.currPt - 1;
            // second, clear the liquid if the currPt is an endpt
            if (cache.currVal & 1 > 0) {
                    SwapMathX2YDesire.RangeRetState memory retState = SwapMathX2YDesire.x2YRange(
                        st,
                        st.currPt,
                        cache._sqrtRate_96,
                        desireY
                    );
                    cache.finished = retState.finished;
                    
                    uint256 feeAmount = FullMath.mulDivRoundingUp(retState.costX, fee, 1e6);

                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);
                    amountX += (retState.costX + feeAmount);
                    amountY += retState.acquireY;
                    desireY = (desireY <= retState.acquireY) ? 0 : desireY - uint128(retState.acquireY);
                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                    if (!cache.finished) {
                        Point.Data storage ptdata = points[st.currPt];
                        ptdata.passEndpt(cache.currFeeScaleX_128, cache.currFeeScaleY_128);
                        st.liquidity = LiquidityMath.addDelta(st.liquidity, - ptdata.liquidDelta);
                        st.currPt = st.currPt - 1;
                        st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                        st.allX = false;
                        st.currX = 0;
                        st.currY = FullMath.mulDiv(st.liquidity, st.sqrtPrice_96, FixedPoint96.Q96);
                    }
            }
            if (cache.finished || st.currPt < lowPt) {
                break;
            }
            int24 nextPt = findLeft(searchStart, cache.pd);
            if (nextPt < lowPt) {
                nextPt = lowPt;
            }
            int24 nextVal = getStatusVal(nextPt, cache.pd);
            // in [st.currPt, nextPt)
            if (st.liquidity == 0) {

                // no liquidity in the range [nextPt, st.currPt]
                st.currPt = nextPt;
                st.sqrtPrice_96 = TickMath.getSqrtRatioAtTick(st.currPt);
                st.allX = true;
                cache.currVal = nextVal;
            } else {
                // amount > 0
                // if (desireY > 0) {
                    SwapMathX2YDesire.RangeRetState memory retState = SwapMathX2YDesire.x2YRange(
                        st, nextPt, cache._sqrtRate_96, desireY
                    );
                    cache.finished = retState.finished;
                    
                    uint256 feeAmount = FullMath.mulDivRoundingUp(retState.costX, fee, 1e6);

                    amountY += retState.acquireY;
                    amountX += (retState.costX + feeAmount);
                    desireY = (desireY <= retState.acquireY) ? 0 : desireY - uint128(retState.acquireY);
                    
                    cache.currFeeScaleX_128 = cache.currFeeScaleX_128 + FullMath.mulDiv(feeAmount, FixedPoint128.Q128, st.liquidity);

                    st.currPt = retState.finalPt;
                    st.sqrtPrice_96 = retState.sqrtFinalPrice_96;
                    st.allX = retState.finalAllX;
                    st.currX = retState.finalCurrX;
                    st.currY = retState.finalCurrY;
                // } else {
                //     cache.finished = true;
                // }
                if (st.currPt == nextPt) {
                    cache.currVal = nextVal;
                } else {
                    // not necessary, because finished must be true
                    cache.currVal = 0;
                }
            }
        }

        // write back fee scale, no fee of y
        feeScaleX_128 = cache.currFeeScaleX_128;
        // write back state
        state = st;
        // transfer y to trader
        if (amountY > 0) {
            TransferHelper.safeTransfer(tokenY, recipient, amountY);
            // trader pay x
            require(amountX > 0, "PP");
            uint256 bx = balanceX();
            IIzumiswapSwapCallback(msg.sender).swapX2YCallback(amountX, data);
            require(balanceX() >= bx + amountX, "XE");
        }
    }
}