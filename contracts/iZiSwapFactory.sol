// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import './interfaces/IiZiSwapFactory.sol';
import './iZiSwapPool.sol';

contract iZiSwapFactory is IiZiSwapFactory {
    address public override owner;
    mapping(address => mapping(address => mapping(uint24 => address))) public override pool;
    mapping(uint24 => int24) public override fee2pointDelta;
    address public only_addr_;

    address public override swapX2YModule;
    address public override swapY2XModule;
    address public override mintModule;
    constructor(address _swapX2YModule, address _swapY2XModule, address _mintModule) {
        only_addr_ = address(this);
        owner = msg.sender;
        fee2pointDelta[500] = 10;
        fee2pointDelta[3000] = 50;
        swapX2YModule = _swapX2YModule;
        swapY2XModule = _swapY2XModule;
        mintModule = _mintModule;
    }
    modifier noDelegateCall() {
        require(address(this) == only_addr_);
        _;
    }
    function enableFeeAmount(uint24 fee, uint24 pointDelta) external override noDelegateCall {
        require(msg.sender == owner, "ON");
        require(pointDelta > 1, "P1");
        require(fee2pointDelta[fee] == 0, "FD0");
        fee2pointDelta[fee] = int24(pointDelta);
    }
    function newPool(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 cp
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
            cp,
            pointDelta
        ));
        pool[tokenX][tokenY][fee] = addr;
        pool[tokenY][tokenX][fee] = addr;
        emit NewPool(tokenX, tokenY, fee, pointDelta, addr);
    }
}