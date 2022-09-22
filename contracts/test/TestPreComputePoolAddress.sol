pragma solidity ^0.8.4;

import "../iZiSwapPool.sol";

contract TestPreComputePoolAddress {

    function preComputePoolAddress(
        address factory,
        address tokenX,
        address tokenY,
        uint24 fee
    ) public pure returns(address pool) {
        if (tokenX > tokenY) {
            (tokenX, tokenY) = (tokenY, tokenX);
        }
        bytes32 salt = keccak256(abi.encode(tokenX, tokenY, fee));
        bytes memory byteCode = type(iZiSwapPool).creationCode;

        bytes32 ret = keccak256(abi.encodePacked(
            bytes1(0xff),
            factory,
            salt,
            keccak256(byteCode)
        ));

        return address(uint160(uint256(ret)));
    }
}
