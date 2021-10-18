pragma solidity ^0.8.4;

import './interfaces/IIzumiswapFactory.sol';
import './IzumiswapPool.sol';

contract IzumiswapFactory is IIzumiswapFactory {
    address public override owner;
    mapping(address => mapping(address => mapping(uint24 => address))) public override pool;
    mapping(uint24 => int24) public override fee2pointDelta;
    address private immutable only_addr_;
    constructor() {
        only_addr_ = address(this);
        owner = msg.sender;
        fee2pointDelta[500] = 10;
        fee2pointDelta[3000] = 50;
    }
    modifier noDelegateCall() {
        require(address(this) == only_addr_);
        _;
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
        
        addr = address(new IzumiswapPool{salt: salt}(
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