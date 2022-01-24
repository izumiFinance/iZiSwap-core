// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './interfaces/IiZiSwapPool.sol';
import './interfaces/IiZiSwapFactory.sol';
import './libraries/Liquidity.sol';
import './libraries/Point.sol';
import './libraries/PointBitmap.sol';
import './libraries/LogPowMath.sol';
import './libraries/MulDivMath.sol';
import './libraries/TwoPower.sol';
import './libraries/LimitOrder.sol';
import './libraries/AmountMath.sol';
import './libraries/UserEarn.sol';
import './libraries/TokenTransfer.sol';
import './libraries/State.sol';
import './libraries/Oracle.sol';
import './interfaces/IiZiSwapCallback.sol';
import 'hardhat/console.sol';

import './libraries/SwapMathY2X.sol';
import './libraries/SwapMathX2Y.sol';

contract iZiSwapPool is IiZiSwapPool {

    using Liquidity for mapping(bytes32 =>Liquidity.Data);
    using Liquidity for Liquidity.Data;
    using Point for mapping(int24 =>Point.Data);
    using Point for Point.Data;
    using PointBitmap for mapping(int16 =>uint256);
    using LimitOrder for LimitOrder.Data;
    using UserEarn for UserEarn.Data;
    using UserEarn for mapping(bytes32 =>UserEarn.Data);
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
    /// @notice The fee growth as a 128-bit fixpoint fees of tokenY collected per 1 liquidity of the pool
    uint256 public feeScaleY_128;

    /// @notice sqrt(1.0001), 96 bit fixpoint number
    uint160 public override sqrtRate_96;

    /// @notice some values of pool
    /// see library State or IiZiSwapPool#state for more infomation
    State public override state;

    /// @notice the information about a liquidity by the liquidity's key
    mapping(bytes32 =>Liquidity.Data) public override liquidities;

    /// @notice 256 packed point (orderOrEndpoint>0) boolean values. See PointBitmap for more information
    mapping(int16 =>uint256) public override pointBitmap;

    /// @notice returns infomation of a point in the pool, see Point library of IiZiSwapPool#poitns for more information
    mapping(int24 =>Point.Data) public override points;
    /// @notice infomation about a point whether has limit order and whether as an liquidity's endpoint
    mapping(int24 =>int24) public override orderOrEndpoint;
    /// @notice limitOrder info on a given point
    mapping(int24 =>LimitOrder.Data) public override limitOrderData;
    /// @notice information about a user's limit order (sell tokenY and earn tokenX)
    mapping(bytes32 => UserEarn.Data) public override userEarnX;
    /// @notice information about a user's limit order (sell tokenX and earn tokenY)
    mapping(bytes32 => UserEarn.Data) public override userEarnY;
    /// @notice observation data array
    Oracle.Observation[65535] public override observations;

    address private  original;

    address private swapModuleX2Y;
    address private swapModuleY2X;
    address private mintModule;

    modifier lock() {
        require(!state.locked, 'LKD');
        state.locked = true;
        _;
        state.locked = false;
    }
    modifier noDelegateCall() {
        require(address(this) == original);
        _;
    }
    function _setRange(int24 pd) private {
        rightMostPt = RIGHT_MOST_PT / pd * pd;
        leftMostPt = - rightMostPt;
        uint24 pointNum = uint24((rightMostPt - leftMostPt) / pd) + 1;
        maxLiquidPt = type(uint128).max / pointNum;
    }

    /// @notice construct a pool
    /// @param _factory address of iZiSwapFactory
    /// @param _tokenX address of tokenX
    /// @param _tokenY address of tokenY
    /// @param _fee fee amount
    /// @param currentPoint initial current point of pool
    /// @param _pointDelta pointDelta of pool, etc. minimum number of distance between initialized or limitorder points 
    constructor(
        address _factory,
        address _tokenX,
        address _tokenY,
        uint24 _fee,
        int24 currentPoint,
        int24 _pointDelta
    ) public {
        require(_tokenX < _tokenY, 'x<y');
        require(_pointDelta > 1);
        original = address(this);
        factory = _factory;
        swapModuleX2Y = IiZiSwapFactory(_factory).swapX2YModule();
        swapModuleY2X = IiZiSwapFactory(_factory).swapY2XModule();
        mintModule = IiZiSwapFactory(_factory).mintModule();

        console.log("swapX2Y: ", swapModuleX2Y);
        console.log("swapY2X: ", swapModuleY2X);
        tokenX = _tokenX;
        tokenY = _tokenY;
        fee = _fee;
        pointDelta = _pointDelta;
        _setRange(_pointDelta);

        require(currentPoint >= leftMostPt, "LO");
        require(currentPoint <= rightMostPt, "HO");

        // current state
        state.currentPoint = currentPoint;
        state.sqrtPrice_96 = LogPowMath.getSqrtPrice(currentPoint);
        state.liquidity = 0;
        state.allX = true;
        state.currX = 0;
        state.currY = 0;
        state.locked = false;

        sqrtRate_96 = LogPowMath.getSqrtPrice(1);

        (state.observationQueueLen, state.observationNextQueueLen) = observations.init(uint32(block.number));
        state.observationCurrentIndex = 0;
    }

    /// @notice mark a given amount of tokenY in a limitorder(sellx and earn y) as assigned
    /// @param point point (log Price) of seller's limit order,be sure to be times of pointDelta
    /// @param assignY max amount of tokenY to mark assigned
    /// @return actualAssignY actual amount of tokenY marked
    function assignLimOrderEarnY(
        int24 point,
        uint256 assignY
    ) external override returns (uint256 actualAssignY) {
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
    ) external override returns (uint256 actualAssignX) {
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
    ) external override returns (uint128 actualDeltaX) {
        
        require(point % pointDelta == 0, "PD");

        UserEarn.Data storage ue = userEarnY.get(msg.sender, point);
        LimitOrder.Data storage pointOrder = limitOrderData[point];
        uint160 sqrtPrice_96 = LogPowMath.getSqrtPrice(point);
        (actualDeltaX, pointOrder.earnY) = ue.dec(deltaX, pointOrder.accEarnY, sqrtPrice_96, pointOrder.earnY, true);
        pointOrder.sellingX -= actualDeltaX;
        
        if (actualDeltaX > 0 && pointOrder.sellingX == 0) {
            int24 newVal = getStatusVal(point, pointDelta) & 1;
            setStatusVal(point, pointDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(point, pointDelta);
            }
        }

        emit DecLimitOrder(actualDeltaX, point, true);
    }

    /// @notice decrease limitorder of selling Y
    /// @param point point of seller's limit order, be sure to be times of pointDelta
    /// @param deltaY max amount of tokenY seller wants to decrease
    /// @return actualDeltaY actual amount of tokenY decreased
    function decLimOrderWithY(
        int24 point,
        uint128 deltaY
    ) external override returns (uint128 actualDeltaY) {
        
        require(point % pointDelta == 0, "PD");

        UserEarn.Data storage ue = userEarnX.get(msg.sender, point);
        LimitOrder.Data storage pointOrder = limitOrderData[point];
        uint160 sqrtPrice_96 = LogPowMath.getSqrtPrice(point);
        (actualDeltaY, pointOrder.earnX) = ue.dec(deltaY, pointOrder.accEarnX, sqrtPrice_96, pointOrder.earnX, false);

        pointOrder.sellingY -= actualDeltaY;
        
        if (actualDeltaY > 0 && pointOrder.sellingY == 0) {
            int24 newVal = getStatusVal(point, pointDelta) & 1;
            setStatusVal(point, pointDelta, newVal);
            if (newVal == 0) {
                pointBitmap.setZero(point, pointDelta);
            }
        }
        
        emit DecLimitOrder(actualDeltaY, point, false);
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
    ) external override returns (uint128 orderX, uint256 acquireY) {
        
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
            int24 val = getStatusVal(point, pointDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                setStatusVal(point, pointDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(point, pointDelta);
                }
            }
        } else {
            int24 val = getStatusVal(point, pointDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                setStatusVal(point, pointDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(point, pointDelta);
                }
            }
        }

        // trader pay x
        uint256 bx = balanceX();
        IiZiSwapAddLimOrderCallback(msg.sender).payCallback(amountX, 0, data);
        require(balanceX() >= bx + amountX, "XE");
        
        emit AddLimitOrder(orderX, point, true);
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
    ) external override returns (uint128 orderY, uint256 acquireX) {
        
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
            int24 val = getStatusVal(point, pointDelta);
            if (val & 2 != 0) {
                int24 newVal = val & 1;
                setStatusVal(point, pointDelta, newVal);
                if (newVal == 0) {
                    pointBitmap.setZero(point, pointDelta);
                }
            }
        } else {
            int24 val = getStatusVal(point, pointDelta);
            if (val & 2 == 0) {
                int24 newVal = val | 2;
                setStatusVal(point, pointDelta, newVal);
                if (val == 0) {
                    pointBitmap.setOne(point, pointDelta);
                }
            }
        }

        // trader pay y
        uint256 by = balanceY();
        IiZiSwapAddLimOrderCallback(msg.sender).payCallback(0, amountY, data);
        require(balanceY() >= by + amountY, "YE");
        
        emit AddLimitOrder(orderY, point, false);
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
    ) external override returns(uint256 actualCollectDec, uint256 actualCollectEarn) {
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
    ) external override noDelegateCall lock returns (uint128 amountX, uint128 amountY) {
        (bool success, bytes memory d) = mintModule.delegatecall(
            abi.encodeWithSignature("mint(address,int24,int24,uint128,bytes)", recipient, leftPt, rightPt,liquidDelta,data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint128, uint128));
            emit Mint(msg.sender, recipient, leftPt, rightPt, liquidDelta, amountX, amountY);
        } else {
            revertDCData(d);
        }
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
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = mintModule.delegatecall(
            abi.encodeWithSignature("burn(int24,int24,uint128)", leftPt, rightPt, liquidDelta)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
            emit Burn(msg.sender, leftPt, rightPt, liquidDelta, amountX, amountY);
        } else {
            revertDCData(d);
        }
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
    ) external override noDelegateCall lock returns (uint256 actualAmountX, uint256 actualAmountY) {
        (bool success, bytes memory d) = mintModule.delegatecall(
            abi.encodeWithSignature("collect(address,int24,int24,uint256,uint256)", recipient, leftPt, rightPt, amountXLim, amountYLim)
        );
        if (success) {
            (actualAmountX, actualAmountY) = abi.decode(d, (uint256, uint256));
        } else {
            revertDCData(d);
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

    function revertDCData(bytes memory data) private pure {
        if (data.length != 64) {
            if (data.length < 68) revert('dc');
            assembly {
                data := add(data, 0x04)
            }
            revert(abi.decode(data, (string)));
        }
        assembly {
            data:= add(data, 0x20)
            let w := mload(data)
            let t := mload(0x40)
            mstore(t, w)
            let w2 := mload(add(data, 0x20))
            mstore(add(t, 0x20), w2)
            revert(t, 64)
        }
    }

    /// @notice Swap tokenY for tokenX， given max amount of tokenY user willing to pay
    /// @param recipient The address to receive tokenX
    /// @param amount The max amount of tokenY user willing to pay
    /// @param highPt the highest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX payed
    /// @return amountY amount of tokenY acquired
    function swapY2X(
        address recipient,
        uint128 amount,
        int24 highPt,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = swapModuleY2X.delegatecall(
            abi.encodeWithSignature("swapY2X(address,uint128,int24,bytes)", 
            recipient, amount, highPt, data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
            emit Swap(tokenY, tokenX, fee, amountY, amountX);
        } else {
            revertDCData(d);
        }
    }

    /// @notice Swap tokenY for tokenX， given amount of tokenX user desires
    /// @param recipient The address to receive tokenX
    /// @param desireX The amount of tokenX user desires
    /// @param highPt the highest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX payed
    /// @return amountY amount of tokenY acquired
    function swapY2XDesireX(
        address recipient,
        uint128 desireX,
        int24 highPt,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = swapModuleY2X.delegatecall(
            abi.encodeWithSignature("swapY2XDesireX(address,uint128,int24,bytes)", 
            recipient, desireX, highPt, data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
            emit Swap(tokenY, tokenX, fee, amountY, amountX);
        } else {
            revertDCData(d);
        }
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

    /// @notice Swap tokenX for tokenY， given max amount of tokenX user willing to pay
    /// @param recipient The address to receive tokenY
    /// @param amount The max amount of tokenX user willing to pay
    /// @param lowPt the lowest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX acquired
    /// @return amountY amount of tokenY payed
    function swapX2Y(
        address recipient,
        uint128 amount,
        int24 lowPt,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = swapModuleX2Y.delegatecall(
            abi.encodeWithSignature("swapX2Y(address,uint128,int24,bytes)", 
            recipient, amount, lowPt, data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
            emit Swap(tokenX, tokenY, fee, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @notice Swap tokenX for tokenY， given amount of tokenY user desires
    /// @param recipient The address to receive tokenY
    /// @param desireY The amount of tokenY user desires
    /// @param lowPt the lowest point(price) of x/y during swap
    /// @param data Any data to be passed through to the callback
    /// @return amountX amount of tokenX acquired
    /// @return amountY amount of tokenY payed
    function swapX2YDesireY(
        address recipient,
        uint128 desireY,
        int24 lowPt,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = swapModuleX2Y.delegatecall(
            abi.encodeWithSignature("swapX2YDesireY(address,uint128,int24,bytes)", recipient, desireY, lowPt,data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
            emit Swap(tokenX, tokenY, fee, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @notice Returns the interpolation value of  cumulative point and liquidity at some target timestamps (block.timestamp - secondsAgo[i])
    /// @dev if you call this method with secondsAgos = [3600, 0]. the average point of this pool during recent hour is 
    /// (pointCumulatives[1] - pointCumulatives[0]) / 3600
    /// @param secondsAgos describe the target timestamp , targetTimestimp[i] = block.timestamp - secondsAgo[i]
    /// @return pointCumulatives Cumulative point values at each target timestamp
    /// @return secondsPerLiquidityCumulative_128s Cumulative seconds per liquidity-in-range value at each target timestamp
    function observe(uint32[] calldata secondsAgos)
        external
        view
        override
        noDelegateCall
        returns (int56[] memory pointCumulatives, uint160[] memory secondsPerLiquidityCumulative_128s)
    {
        return
            observations.observe(
                uint32(block.timestamp),
                secondsAgos,
                state.currentPoint,
                state.observationCurrentIndex,
                state.liquidity,
                state.observationQueueLen
            );
    }

    /// @notice increase value of observationNextQueueLen of observation circular queue
    /// @param newNextQueueLen new value of observationNextQueueLen, which should be greater than current observationNextQueueLen
    function expandObservationQueue(uint16 newNextQueueLen) external override noDelegateCall {
        uint16 oldNextQueueLen = state.observationNextQueueLen;
        if (newNextQueueLen > oldNextQueueLen) {
            observations.expand(oldNextQueueLen, newNextQueueLen);
            state.observationNextQueueLen = newNextQueueLen;
        }
    }

    /// @notice return a snapshot infomation of Liquidity in [leftPoint, rightPoint)
    /// @param leftPoint left endpoint of range, should be times of pointDelta
    /// @param rightPoint right endpoint of range, should be times of pointDelta
    /// @return deltaLiquidities an array of delta liquidity for points in the range
    ///    note 1. delta liquidity here is amount of liquidity changed when cross a point from left to right
    ///    note 2. deltaLiquidities only contains points which are times of pointDelta
    ///    note 3. this function may cost a HUGE amount of gas, be careful to call
    function liquiditySnapshot(int24 leftPoint, int24 rightPoint) external override view returns(int128[] memory deltaLiquidities) {
        require(leftPoint < rightPoint, "L<R");
        require(leftPoint >= leftMostPt, "LO");
        require(rightPoint <= rightMostPt, "RO");
        require(leftPoint % pointDelta == 0, "LD0");
        require(rightPoint % pointDelta == 0, "RD0");
        uint256 len = uint256(int256((rightPoint - leftPoint) / pointDelta));
        deltaLiquidities = new int128[](len);
        uint256 idx = 0;
        for (int24 i = leftPoint; i < rightPoint; i += pointDelta) {
            deltaLiquidities[idx] = points[i].liquidDelta;
            idx ++;
        }
    }
}