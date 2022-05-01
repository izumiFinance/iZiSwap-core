pragma solidity ^0.8.4;

import 'hardhat/console.sol';

import '../libraries/Liquidity.sol';

contract TestCalc {
    
    function addu256(uint256 a, uint256 b) public pure returns (uint256 c) {
        c = a + b;
    }

    function addu128(uint128 a, uint128 b) public pure returns (uint128 c) {
        c = a + b;
    }
    function addi128(int128 a, int128 b) public pure returns (int128 c) {
        c = a + b;
    }
    function addi256(int256 a, int256 b) public pure returns (int256 c) {
        c = a + b;
    }

    function subu256(uint256 a, uint256 b) public pure returns (uint256 c) {
        c = a - b;
    }

    function subu128(uint128 a, uint128 b) public pure returns (uint128 c) {
        c = a - b;
    }
    function subi128(int128 a, int128 b) public pure returns (int128 c) {
        c = a - b;
    }
    function subi256(int256 a, int256 b) public pure returns (int256 c) {
        c = a - b;
    }

    function converti2562i128(int256 a) public pure returns(int128 b) {
        b = int128(a);
    }
    function convertu2562u128(uint256 a) public pure returns(uint128 b) {
        b = uint128(a);
    }

    function convertu2562i256(uint256 a) public pure returns(int256 b) {
        b = int256(a);
    }

    function converti2562u256(int256 a) public pure returns(uint256 b) {
        b = uint256(a);
    }
    function convertu1282i128(uint128 a) public pure returns(int128 b) {
        b = int128(a);
    }

    function converti1282u128(int128 a) public pure returns(uint128 b) {
        b = uint128(a);
    }

    mapping(uint256=>uint256) public values;

    address public testCalc;

    function loop(uint256 a, uint256 b) public {
        uint256 i = 0;
        while (i < a) {
            values[i] = b;
        }
    }

    function liquidityAddDelta(uint128 l, int128 delta) public pure returns(uint128 nl) {
        return Liquidity.liquidityAddDelta(l, delta);
    }
    function negative(int128 delta) public pure returns(uint128) {
        return uint128(-delta);
    }

    function wordBitIdx(int24 mapPt) public pure returns(int16 wordIdx, uint8 bitIdx) {
        wordIdx = int16(mapPt >> 8);
        bitIdx = uint8(uint24(mapPt % 256));
    }
}
