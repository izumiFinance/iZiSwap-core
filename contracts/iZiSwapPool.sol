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

    // TODO following usings may need modify
    using Liquidity for mapping(bytes32 =>Liquidity.Data);
    using Liquidity for Liquidity.Data;
    using Point for mapping(int24 =>Point.Data);
    using Point for Point.Data;
    using PointBitmap for mapping(int16 =>uint256);
    using LimitOrder for LimitOrder.Data;
    using UserEarn for UserEarn.Data;
    using UserEarn for mapping(bytes32 =>UserEarn.Data);
    using Oracle for Oracle.Observation[65535];
    
    // using SwapMathY2X for SwapMathY2X.RangeRetState;
    // using SwapMathX2Y for SwapMathX2Y.RangeRetState;

    // TODO following values need change
    int24 internal constant LEFT_MOST_PT = -800000;
    int24 internal constant RIGHT_MOST_PT = 800000;

    int24 private leftMostPt;
    int24 private rightMostPt;
    uint128 private maxLiquidPt;

    address public  factory;
    address public  tokenX;
    address public  tokenY;
    uint24 public  fee;
    int24 public  pointDelta;

    uint256 public feeScaleX_128;
    uint256 public feeScaleY_128;

    uint160 public override sqrtRate_96;

    State public override state;

    /// TODO: following mappings may need modify
    mapping(bytes32 =>Liquidity.Data) public override liquidities;
    mapping(int16 =>uint256) public override pointBitmap;
    mapping(int24 =>Point.Data) public override points;
    mapping(int24 =>int24) public override statusVal;
    mapping(int24 =>LimitOrder.Data) public override limitOrderData;
    mapping(bytes32 => UserEarn.Data) public override userEarnX;
    mapping(bytes32 => UserEarn.Data) public override userEarnY;
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
        
    }

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
        
    }


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
        
    }
    
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
        
    }

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
    /// @dev mint
    /// @param minter minter address
    function mint(
        address minter,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta,
        bytes calldata data
    ) external override noDelegateCall lock returns (uint128 amountX, uint128 amountY) {
        (bool success, bytes memory d) = mintModule.delegatecall(
            abi.encodeWithSignature("mint(address,int24,int24,uint128,bytes)", minter, leftPt, rightPt,liquidDelta,data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint128, uint128));
        } else {
            revertDCData(d);
        }
    }

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
        } else {
            revertDCData(d);
        }
    }

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
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = swapModuleY2X.delegatecall(
            abi.encodeWithSignature("swapY2X(address,uint128,int24,bytes)", 
            recipient, amount, highPt, data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
        } else {
            revertDCData(d);
        }
    }

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
        } else {
            revertDCData(d);
        }
    }

    function getStatusVal(int24 point, int24 pd) internal view returns(int24 val) {
        if (point % pd != 0) {
            return 0;
        }
        val = statusVal[point / pd];
    }
    function setStatusVal(int24 point, int24 pd, int24 val) internal {
        statusVal[point / pd] = val;
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
    ) external override noDelegateCall lock returns (uint256 amountX, uint256 amountY) {
        (bool success, bytes memory d) = swapModuleX2Y.delegatecall(
            abi.encodeWithSignature("swapX2Y(address,uint128,int24,bytes)", 
            recipient, amount, lowPt, data)
        );
        if (success) {
            (amountX, amountY) = abi.decode(d, (uint256, uint256));
        } else {
            revertDCData(d);
        }
    }

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
        } else {
            revertDCData(d);
        }
    }

    /// 
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
}