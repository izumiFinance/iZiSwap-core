// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import '../libraries/Point.sol';
import '../libraries/TwoPower.sol';

contract StorageGasTest {
    mapping(int24 => Point.Data) public points;
    uint256 public gasUsed;

    function getGasCostOfSave() external returns (uint256) {
        uint256 gasBefore = gasleft();
        points[10] = Point.Data({
            liquidSum: 1000,
            liquidDelta: 2000,
            accFeeXOut_128: 10000,
            accFeeYOut_128: 10000,
            isEndpt: true
        });
        gasUsed = gasBefore - gasleft();
        return gasUsed;
    }

    function getGasCostOfReadWithStorage() external returns (uint256) {
        uint256 gasBefore = gasleft();
        Point.Data storage data = points[10];
        uint128 liquidSum = data.liquidSum;
        uint256 a = 10;
        uint256 b = 10;
        uint256 c = 10;
        uint256 d = 10;
        uint256 acc1 = data.accFeeXOut_128;
        int128 liquidDelta = data.liquidDelta;
        //uint256 acc2 = data.accFeeYOut_128;
        //bool i = data.isEndpt;
        uint256 e = TwoPower.Pow128;
        uint256 f = TwoPower.Pow96;
        gasUsed = gasBefore - gasleft();
        return gasUsed;
    }

    function getGasCostOfReadWithMemory() external returns (uint256) {
        uint256 gasBefore = gasleft();
        Point.Data memory data = points[10];
        uint128 liquidSum = data.liquidSum;
        uint128 liquidSum2 = data.liquidSum;
        gasUsed = gasBefore - gasleft();
        return gasUsed;
    }

    function getGasCostOfReadWithMemCache() external returns (uint256) {
        uint256 gasBefore = gasleft();
        Point.Data storage data = points[10];
        uint128 liquidSum = data.liquidSum;
        uint128 liquidSum2 = liquidSum;
        gasUsed = gasBefore - gasleft();
        return gasUsed;
    }
}
