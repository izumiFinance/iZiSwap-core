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
import './libraries/OrderOrEndpoint.sol';
import './interfaces/IiZiSwapCallback.sol';

import 'hardhat/console.sol';

contract LimitOrderModule {

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
    using OrderOrEndpoint for mapping(int24 =>int24);

    int24 internal constant LEFT_MOST_PT = -800000;
    int24 internal constant RIGHT_MOST_PT = 800000;

    /// @notice left most point regularized by pointDelta
    int24 public leftMostPt;
    /// @notice right most point regularized by pointDelta
    int24 public rightMostPt;
    /// @notice maximum liquidSum for each point, see points() in IiZiSwapPool or library Point
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

    uint256 public totalFeeXCharged;
    uint256 public totalFeeYCharged;

    address private  original;

    address private swapModuleX2Y;
    address private swapModuleY2X;
    address private mintModule;

    /// @notice percent to charge from miner's fee
    uint24 public immutable feeChargePercent = 20;

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


    /// @notice mark a given amount of tokenY in a limitorder(sellx and earn y) as assigned
    /// @param point point (log Price) of seller's limit order,be sure to be times of pointDelta
    /// @param assignY max amount of tokenY to mark assigned
    /// @return actualAssignY actual amount of tokenY marked
    function assignLimOrderEarnY(
        int24 point,
        uint256 assignY
    ) external returns (uint256 actualAssignY) {
        actualAssignY = assignY;
        UserEarn.Data storage ue = userEarnY.get(msg.sender, point);
        if (actualAssignY > ue.earn) {
            actualAssignY = ue.earn;
        }
        ue.earn -= actualAssignY;
        ue.earnAssign += actualAssignY;
    }

    /// @notice mark a given amount of tokenX in a limitorder(selly and earn x) as assigned
    /// @param point point (log Price) of seller's limit order,be sure to be times of pointDelta
    /// @param assignX max amount of tokenX to mark assigned
    /// @return actualAssignX actual amount of tokenX marked
    function assignLimOrderEarnX(
        int24 point,
        uint256 assignX
    ) external returns (uint256 actualAssignX) {
        actualAssignX = assignX;
        UserEarn.Data storage ue = userEarnX.get(msg.sender, point);
        if (actualAssignX > ue.earn) {
            actualAssignX = ue.earn;
        }
        ue.earn -= actualAssignX;
        ue.earnAssign += actualAssignX;
    }

    /// @notice decrease limitorder of selling X
    /// @param point point of seller's limit order, be sure to be times of pointDelta
    /// @param deltaX max amount of tokenX seller wants to decrease
    /// @return actualDeltaX actual amount of tokenX decreased
    function decLimOrderWithX(
        int24 point,
        uint128 deltaX
    ) external returns (uint128 actualDeltaX) {
        
        require(point % pointDelta == 0, "PD");

        UserEarn.Data storage ue = userEarnY.get(msg.sender, point);
        LimitOrder.Data storage pointOrder = limitOrderData[point];
        uint160 sqrtPrice_96 = LogPowMath.getSqrtPrice(point);
        (actualDeltaX, pointOrder.earnY) = ue.dec(deltaX, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnY, true);
        pointOrder.sellingX -= actualDeltaX;
        
        if (actualDeltaX > 0 && pointOrder.sellingX == 0) {
            int24 newVal = orderOrEndpoint.getOrderOrEndptVal(point, pointDelta) & 1;
            orderOrEndpoint.setOrderOrEndptVal(point, pointDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(point, pointDelta);
            }
        }

    }

    /// @notice decrease limitorder of selling Y
    /// @param point point of seller's limit order, be sure to be times of pointDelta
    /// @param deltaY max amount of tokenY seller wants to decrease
    /// @return actualDeltaY actual amount of tokenY decreased
    function decLimOrderWithY(
        int24 point,
        uint128 deltaY
    ) external returns (uint128 actualDeltaY) {
        
        require(point % pointDelta == 0, "PD");

        UserEarn.Data storage ue = userEarnX.get(msg.sender, point);
        LimitOrder.Data storage pointOrder = limitOrderData[point];
        uint160 sqrtPrice_96 = LogPowMath.getSqrtPrice(point);
        (actualDeltaY, pointOrder.earnX) = ue.dec(deltaY, pointOrder.accEarnX, sqrtPrice_96, pointOrder.earnX, false);

        pointOrder.sellingY -= actualDeltaY;
        
        if (actualDeltaY > 0 && pointOrder.sellingY == 0) {
            int24 newVal = orderOrEndpoint.getOrderOrEndptVal(point, pointDelta) & 1;
            orderOrEndpoint.setOrderOrEndptVal(point, pointDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(point, pointDelta);
            }
        }
        
    }

    /// @notice add a limit order (selling x) in the pool
    /// @param recipient owner of the limit order
    /// @param point point of the order, be sure to be times of pointDelta
    /// @param amountX amount of tokenX to sell
    /// @param data Any data that should be passed through to the callback
    /// @return orderX actual added amount of tokenX
    /// Returns acquireY amount of tokenY acquired if there is a limit order to sell y before adding
    function addLimOrderWithX(
        address recipient,
        int24 point,
        uint128 amountX,
        bytes calldata data
    ) external returns (uint128 orderX, uint256 acquireY) {
        
        require(point % pointDelta == 0, "PD");
        require(point >= state.currentPoint, "PG");
        require(point <= rightMostPt, "HO");
        require(amountX > 0, "XP");

        
        // update point order
        LimitOrder.Data storage pointOrder = limitOrderData[point];

        orderX = amountX;
        acquireY = 0;
        uint160 sqrtPrice_96 = LogPowMath.getSqrtPrice(point);
        
        uint256 currY = pointOrder.sellingY;
        uint256 currX = pointOrder.sellingX;
        if (currY > 0) {
            uint128 costX;
            (costX, acquireY) = SwapMathX2Y.x2YAtPrice(amountX, sqrtPrice_96, currY);
            orderX -= costX;
            currY -= acquireY;
            pointOrder.accEarnX = pointOrder.accEarnX + costX;
            pointOrder.earnX = pointOrder.earnX + costX;
            pointOrder.sellingY = currY;
        }
        if (orderX > 0) {
            currX += orderX;
            pointOrder.sellingX = currX;
        }

        UserEarn.Data storage ue = userEarnY.get(recipient, point);
        pointOrder.earnY = ue.add(orderX, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnY, true);
        ue.earnAssign = ue.earnAssign + acquireY;
        
        // update statusval and bitmap
        if (currX == 0 && currY == 0) {
            int24 val = orderOrEndpoint.getOrderOrEndptVal(point, pointDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                orderOrEndpoint.setOrderOrEndptVal(point, pointDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(point, pointDelta);
                }
            }
        } else {
            int24 val = orderOrEndpoint.getOrderOrEndptVal(point, pointDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                orderOrEndpoint.setOrderOrEndptVal(point, pointDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(point, pointDelta);
                }
            }
        }

        // trader pay x
        uint256 bx = balanceX();
        IiZiSwapAddLimOrderCallback(msg.sender).payCallback(amountX, 0, data);
        require(balanceX() >= bx + amountX, "XE");
        
    }
    
    /// @notice add a limit order (selling y) in the pool
    /// @param recipient owner of the limit order
    /// @param point point of the order, be sure to be times of pointDelta
    /// @param amountY amount of tokenY to sell
    /// @param data Any data that should be passed through to the callback
    /// @return orderY actual added amount of tokenY
    /// Returns acquireX amount of tokenX acquired if there exists a limit order to sell x before adding
    function addLimOrderWithY(
        address recipient,
        int24 point,
        uint128 amountY,
        bytes calldata data
    ) external returns (uint128 orderY, uint256 acquireX) {
        
        require(point % pointDelta == 0, "PD");
        require(point <= state.currentPoint, "PL");
        require(point >= leftMostPt, "LO");
        require(amountY > 0, "YP");

        // update point order
        LimitOrder.Data storage pointOrder = limitOrderData[point];

        orderY = amountY;
        acquireX = 0;
        uint160 sqrtPrice_96 = LogPowMath.getSqrtPrice(point);
        uint256 currY = pointOrder.sellingY;
        uint256 currX = pointOrder.sellingX;
        if (currX > 0) {
            uint128 costY;
            (costY, acquireX) = SwapMathY2X.y2XAtPrice(amountY, sqrtPrice_96, currX);
            orderY -= costY;
            currX -= acquireX;
            pointOrder.accEarnY = pointOrder.accEarnY + costY;
            pointOrder.earnY = pointOrder.earnY + costY;
            pointOrder.sellingX = currX;
        }
        if (orderY > 0) {
            currY += orderY;
            pointOrder.sellingY = currY;
        }
        UserEarn.Data storage ue = userEarnX.get(recipient, point);
        pointOrder.earnX = ue.add(orderY, pointOrder.accEarnX, sqrtPrice_96, pointOrder.earnX, false);
        ue.earnAssign = ue.earnAssign + acquireX;

        // update statusval and bitmap
        if (currX == 0 && currY == 0) {
            int24 val = orderOrEndpoint.getOrderOrEndptVal(point, pointDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                orderOrEndpoint.setOrderOrEndptVal(point, pointDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(point, pointDelta);
                }
            }
        } else {
            int24 val = orderOrEndpoint.getOrderOrEndptVal(point, pointDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                orderOrEndpoint.setOrderOrEndptVal(point, pointDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(point, pointDelta);
                }
            }
        }

        // trader pay y
        uint256 by = balanceY();
        IiZiSwapAddLimOrderCallback(msg.sender).payCallback(0, amountY, data);
        require(balanceY() >= by + amountY, "YE");
    }

    /// @notice collect earned or decreased token from limit order
    /// @param recipient address to benefit
    /// @param point point of limit order, be sure to be times of pointDelta
    /// @param collectDec max amount of decreased selling token to collect
    /// @param collectEarn max amount of earned token to collect
    /// @param isEarnY direction of this limit order, true for sell y, false for sell x
    /// @return actualCollectDec actual amount of decresed selling token collected
    /// Returns actualCollectEarn actual amount of earned token collected
    function collectLimOrder(
        address recipient, int24 point, uint256 collectDec, uint256 collectEarn, bool isEarnY
    ) external returns(uint256 actualCollectDec, uint256 actualCollectEarn) {
        UserEarn.Data storage ue = isEarnY? userEarnY.get(msg.sender, point) : userEarnX.get(msg.sender, point);
        actualCollectDec = collectDec;
        if (actualCollectDec > ue.sellingDec) {
            actualCollectDec = ue.sellingDec;
        }
        ue.sellingDec = ue.sellingDec - actualCollectDec;
        actualCollectEarn = collectEarn;
        if (actualCollectEarn > ue.earnAssign) {
            actualCollectEarn = ue.earnAssign;
        }
        ue.earnAssign = ue.earnAssign - actualCollectEarn;
        (uint256 x, uint256 y) = isEarnY? (actualCollectDec, actualCollectEarn): (actualCollectEarn, actualCollectDec);
        if (x > 0) {
            TokenTransfer.transferToken(tokenX, recipient, x);
        }
        if (y > 0) {
            TokenTransfer.transferToken(tokenY, recipient, y);
        }
    }
}