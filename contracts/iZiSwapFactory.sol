// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './interfaces/IiZiSwapFactory.sol';
import './iZiSwapPool.sol';

contract iZiSwapFactory is IiZiSwapFactory {

    /// @notice owner of factory
    address public override owner;

    /// @notice charge receiver of all pools in this factory
    address public override chargeReceiver;

    /// @notice tokenX/tokenY/fee => pool address
    mapping(address => mapping(address => mapping(uint24 => address))) public override pool;

    /// @notice mapping from fee amount to pointDelta
    mapping(uint24 => int24) public override fee2pointDelta;

    /// @notice mark contract address in constructor to avoid delegate call
    address public only_addr_;

    /// @notice address of module to support swapX2Y(DesireY)
    address public override swapX2YModule;

    /// @notice address of module to support swapY2X(DesireX)
    address public override swapY2XModule;

    /// @notice address of module to support mint
    address public override mintModule;

    /// @notice construct the factory
    /// @param _swapX2YModule swap module to support swapX2Y(DesireY)
    /// @param _swapY2XModule swap module to support swapY2X(DesireX)
    /// @param _mintModule mint module to support mint/burn/collect
    constructor(address _chargeReceiver, address _swapX2YModule, address _swapY2XModule, address _mintModule) {
        only_addr_ = address(this);
        owner = msg.sender;
        fee2pointDelta[500] = 10;
        fee2pointDelta[3000] = 50;
        swapX2YModule = _swapX2YModule;
        swapY2XModule = _swapY2XModule;
        mintModule = _mintModule;
        chargeReceiver = _chargeReceiver;
    }

    modifier noDelegateCall() {
        require(address(this) == only_addr_);
        _;
    }

    /// @notice Enables a fee amount with the given pointDelta
    /// @dev Fee amounts may never be removed once enabled
    /// @param fee fee amount (3000 means 0.3%)
    /// @param pointDelta The spacing between points to be enforced for all pools created with the given fee amount
    function enableFeeAmount(uint24 fee, uint24 pointDelta) external override noDelegateCall {
        require(msg.sender == owner, "ON");
        require(pointDelta > 1, "P1");
        require(fee2pointDelta[fee] == 0, "FD0");
        fee2pointDelta[fee] = int24(pointDelta);
    }

    /// @notice create a new pool which not exists
    /// @param tokenX address of tokenX
    /// @param tokenY address of tokenY
    /// @param fee fee amount
    /// @param currentPoint initial point (log 1.0001 of price)
    /// @return addr address of newly created pool
    function newPool(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 currentPoint
    ) external override noDelegateCall returns (address addr) {
        require(tokenX != tokenY, "SmTK");
        if (tokenX > tokenY) {
            (tokenX, tokenY) = (tokenY, tokenX);
        }
        require(pool[tokenX][tokenY][fee] == address(0));
        int24 pointDelta = fee2pointDelta[fee];
        require(pointDelta > 0);
        // now creating
        bytes32 salt = keccak256(abi.encode(tokenX, tokenY, fee));
        
        addr = address(new iZiSwapPool{salt: salt}(
            address(this),
            tokenX,
            tokenY,
            fee,
            currentPoint,
            pointDelta
        ));
        pool[tokenX][tokenY][fee] = addr;
        pool[tokenY][tokenX][fee] = addr;
        emit NewPool(tokenX, tokenY, fee, uint24(pointDelta), addr);
    }

    /// @notice change charge receiver, only owner of factory can call
    /// @param _chargeReceiver address of new receiver
    function modifyChargeReceiver(address _chargeReceiver) external override {
        require(msg.sender == owner, "Not Owner!");
        chargeReceiver = _chargeReceiver;
    }
}