// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './interfaces/IiZiSwapPool.sol';
import './interfaces/IiZiSwapFactory.sol';
import './interfaces/IiZiSwapFlashCallback.sol';
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
import './libraries/OrderOrEndpoint.sol';
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
    /// @notice The fee growth as a 128-bit fixpoint fees of tokenY collected per 1 liquidity of the pool
    uint256 public feeScaleY_128;

    /// @notice sqrt(1.0001), 96 bit fixpoint number
    uint160 public override sqrtRate_96;

    /// @notice state of pool, see library State or IiZiSwapPool#state for more infomation
    State public override state;

    /// @notice the information about a liquidity by the liquidity's key
    mapping(bytes32 =>Liquidity.Data) public override liquidity;

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

    uint256 public override totalFeeXCharged;
    uint256 public override totalFeeYCharged;

    address private original;

    address private swapModuleX2Y;
    address private swapModuleY2X;
    address private liquidityModule;
    address private limitOrderModule;
    address private flashModule;

    /// @notice percent to charge from miner's fee
    uint24 public immutable override feeChargePercent = 50;

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
        require(_pointDelta > 0, 'pd0');
        original = address(this);
        factory = _factory;
        swapModuleX2Y = IiZiSwapFactory(_factory).swapX2YModule();
        swapModuleY2X = IiZiSwapFactory(_factory).swapY2XModule();
        liquidityModule = IiZiSwapFactory(_factory).liquidityModule();
        limitOrderModule = IiZiSwapFactory(_factory).limitOrderModule();
        flashModule = IiZiSwapFactory(_factory).flashModule();

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
        state.liquidityX = 0;

        sqrtRate_96 = LogPowMath.getSqrtPrice(1);

        (state.observationQueueLen, state.observationNextQueueLen) = observations.init(uint32(block.number));
        state.observationCurrentIndex = 0;
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

    /// @inheritdoc IiZiSwapPool
    function assignLimOrderEarnY(
        int24 point,
        uint128 assignY
    ) external override noDelegateCall lock returns (uint128 actualAssignY) {
        
        (bool success, bytes memory d) = limitOrderModule.delegatecall(
            abi.encodeWithSignature("assignLimOrderEarnY(int24,uint128)", point, assignY)
        );
        if (success) {
            actualAssignY = abi.decode(d, (uint128));
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
    function assignLimOrderEarnX(
        int24 point,
        uint128 assignX
    ) external override noDelegateCall lock returns (uint128 actualAssignX) {
        
        (bool success, bytes memory d) = limitOrderModule.delegatecall(
            abi.encodeWithSignature("assignLimOrderEarnX(int24,uint128)", point, assignX)
        );
        if (success) {
            actualAssignX = abi.decode(d, (uint128));
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
    function decLimOrderWithX(
        int24 point,
        uint128 deltaX
    ) external override noDelegateCall lock returns (uint128 actualDeltaX) {
        
        (bool success, bytes memory d) = limitOrderModule.delegatecall(
            abi.encodeWithSignature("decLimOrderWithX(int24,uint128)", point, deltaX)
        );
        if (success) {
            actualDeltaX = abi.decode(d, (uint128));
            emit DecLimitOrder(actualDeltaX, point, true);
        } else {
            revertDCData(d);
        }

    }

    /// @inheritdoc IiZiSwapPool
    function decLimOrderWithY(
        int24 point,
        uint128 deltaY
    ) external override noDelegateCall lock returns (uint128 actualDeltaY) {
        
        (bool success, bytes memory d) = limitOrderModule.delegatecall(
            abi.encodeWithSignature("decLimOrderWithY(int24,uint128)", point, deltaY)
        );
        if (success) {
            actualDeltaY = abi.decode(d, (uint128));
            emit DecLimitOrder(actualDeltaY, point, false);
        } else {
            revertDCData(d);
        }
        
    }

    /// @inheritdoc IiZiSwapPool
    function addLimOrderWithX(
        address recipient,
        int24 point,
        uint128 amountX,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint128 orderX, uint128 acquireY) {
        
        (bool success, bytes memory d) = limitOrderModule.delegatecall(
            abi.encodeWithSignature("addLimOrderWithX(address,int24,uint128,bytes)", recipient, point, amountX, data)
        );
        if (success) {
            (orderX, acquireY) = abi.decode(d, (uint128, uint128));
            emit AddLimitOrder(orderX, point, true);
        } else {
            revertDCData(d);
        }
        
    }
    
    /// @inheritdoc IiZiSwapPool
    function addLimOrderWithY(
        address recipient,
        int24 point,
        uint128 amountY,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint128 orderY, uint128 acquireX) {
        
        (bool success, bytes memory d) = limitOrderModule.delegatecall(
            abi.encodeWithSignature("addLimOrderWithY(address,int24,uint128,bytes)", recipient, point, amountY, data)
        );
        if (success) {
            (orderY, acquireX) = abi.decode(d, (uint128, uint128));
            emit AddLimitOrder(orderY, point, false);
        } else {
            revertDCData(d);
        }
        
    }

    /// @inheritdoc IiZiSwapPool
    function collectLimOrder(
        address recipient, int24 point, uint128 collectDec, uint128 collectEarn, bool isEarnY
    ) external override noDelegateCall lock returns(uint128 actualCollectDec, uint128 actualCollectEarn) {
        (bool success, bytes memory d) = limitOrderModule.delegatecall(
            abi.encodeWithSignature("collectLimOrder(address,int24,uint128,uint128,bool)", recipient, point, collectDec, collectEarn, isEarnY)
        );
        if (success) {
            (actualCollectDec, actualCollectEarn) = abi.decode(d, (uint128, uint128));
        } else {
            revertDCData(d);
        }
    }
    
    /// @inheritdoc IiZiSwapPool
    function mint(
        address recipient,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = liquidityModule.delegatecall(
            abi.encodeWithSignature("mint(address,int24,int24,uint128,bytes)", recipient, leftPt, rightPt,liquidDelta,data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
            emit Mint(msg.sender, recipient, leftPt, rightPt, liquidDelta, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
    function burn(
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = liquidityModule.delegatecall(
            abi.encodeWithSignature("burn(int24,int24,uint128)", leftPt, rightPt, liquidDelta)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
            emit Burn(msg.sender, leftPt, rightPt, liquidDelta, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
    function collect(
        address recipient,
        int24 leftPt,
        int24 rightPt,
        uint256 amountXLim,
        uint256 amountYLim
    ) external override noDelegateCall lock returns (uint256 actualAmountX, uint256 actualAmountY) {
        (bool success, bytes memory d) = liquidityModule.delegatecall(
            abi.encodeWithSignature("collect(address,int24,int24,uint256,uint256)", recipient, leftPt, rightPt, amountXLim, amountYLim)
        );
        if (success) {
            (actualAmountX, actualAmountY) = abi.decode(d, (uint256, uint256));
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
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
            emit Swap(tokenX, tokenY, fee, false, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
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
            emit Swap(tokenX, tokenY, fee, false, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
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
            emit Swap(tokenX, tokenY, fee, true, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
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
            emit Swap(tokenX, tokenY, fee, true, amountX, amountY);
        } else {
            revertDCData(d);
        }
    }

    /// @inheritdoc IiZiSwapPool
    function observe(uint32[] calldata secondsAgos)
        external
        view
        override
        noDelegateCall
        returns (int56[] memory accPoints)
    {
        return
            observations.observe(
                uint32(block.timestamp),
                secondsAgos,
                state.currentPoint,
                state.observationCurrentIndex,
                state.observationQueueLen
            );
    }

    /// @inheritdoc IiZiSwapPool
    function expandObservationQueue(uint16 newNextQueueLen) external override noDelegateCall {
        uint16 oldNextQueueLen = state.observationNextQueueLen;
        if (newNextQueueLen > oldNextQueueLen) {
            observations.expand(oldNextQueueLen, newNextQueueLen);
            state.observationNextQueueLen = newNextQueueLen;
        }
    }

    /// @inheritdoc IiZiSwapPool
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

    /// @inheritdoc IiZiSwapPool
    function limitOrderSnapshot(int24 leftPoint, int24 rightPoint) external override view returns(LimitOrderStruct[] memory limitOrders) {
        require(leftPoint < rightPoint, "L<R");
        require(leftPoint >= leftMostPt, "LO");
        require(rightPoint <= rightMostPt, "RO");
        require(leftPoint % pointDelta == 0, "LD0");
        require(rightPoint % pointDelta == 0, "RD0");
        uint256 len = uint256(int256((rightPoint - leftPoint) / pointDelta));
        limitOrders = new LimitOrderStruct[](len);
        uint256 idx = 0;
        for (int24 i = leftPoint; i < rightPoint; i += pointDelta) {
            limitOrders[idx] = LimitOrderStruct({
                sellingX: limitOrderData[i].sellingX,
                earnY: limitOrderData[i].earnY,
                accEarnY: limitOrderData[i].accEarnY,
                sellingY: limitOrderData[i].sellingY,
                earnX: limitOrderData[i].earnX,
                accEarnX: limitOrderData[i].accEarnX
            });
            idx ++;
        }
    }

    /// @inheritdoc IiZiSwapPool
    function collectFeeCharged() external override noDelegateCall lock {
        require(msg.sender == IiZiSwapFactory(factory).chargeReceiver(), "NR");
        TokenTransfer.transferToken(tokenX, msg.sender, totalFeeXCharged);
        TokenTransfer.transferToken(tokenY, msg.sender, totalFeeYCharged);
        totalFeeXCharged = 0;
        totalFeeYCharged = 0;
    }

    /// @inheritdoc IiZiSwapPool
    function flash(
        address recipient,
        uint256 amountX,
        uint256 amountY,
        bytes calldata data
    ) external override noDelegateCall lock {
        (bool success, bytes memory d) = flashModule.delegatecall(
            abi.encodeWithSignature("flash(address,uint256,uint256,bytes)", 
            recipient, amountX, amountY, data)
        );
        if (success) {
            (uint256 actualAmountX, uint256 actualAmountY, uint256 paidX, uint256 paidY) = abi.decode(d, (uint256, uint256, uint256, uint256));
            emit Flash(msg.sender, recipient, actualAmountX, actualAmountY, paidX, paidY);
        } else {
            revertDCData(d);
        }
    }
}