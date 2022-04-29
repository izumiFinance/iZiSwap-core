// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "../libraries/Point.sol";
import "../libraries/TwoPower.sol";

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
        uint256 acc1 = data.accFeeXOut_128;
        int128 liquidDelta = data.liquidDelta;
        uint256 acc2 = data.accFeeYOut_128;
        bool isEndpt = data.isEndpt;
        gasUsed = gasBefore - gasleft();
        points[10] = Point.Data({
            liquidSum: liquidSum,
            liquidDelta: liquidDelta,
            accFeeXOut_128: acc1,
            accFeeYOut_128: acc2,
            isEndpt: isEndpt
        });
        return gasUsed;
    }

    function getGasCostOfReadWithMemory() external returns (uint256) {
        uint256 gasBefore = gasleft();
        Point.Data memory data = points[10];
        uint128 liquidSum = data.liquidSum;
        liquidSum = data.liquidSum;
        gasUsed = gasBefore - gasleft();
        uint256 acc1 = data.accFeeXOut_128;
        int128 liquidDelta = data.liquidDelta;
        uint256 acc2 = data.accFeeYOut_128;
        bool isEndpt = data.isEndpt;
        points[10] = Point.Data({
            liquidSum: liquidSum,
            liquidDelta: liquidDelta,
            accFeeXOut_128: acc1,
            accFeeYOut_128: acc2,
            isEndpt: isEndpt
        });
        return gasUsed;
    }

    function getGasCostOfReadWithMemCache() external returns (uint256) {
        uint256 gasBefore = gasleft();
        Point.Data storage data = points[10];
        uint128 liquidSum = data.liquidSum;
        liquidSum = liquidSum;
        gasUsed = gasBefore - gasleft();
        uint256 acc1 = data.accFeeXOut_128;
        int128 liquidDelta = data.liquidDelta;
        uint256 acc2 = data.accFeeYOut_128;
        bool isEndpt = data.isEndpt;
        points[10] = Point.Data({
            liquidSum: liquidSum,
            liquidDelta: liquidDelta,
            accFeeXOut_128: acc1,
            accFeeYOut_128: acc2,
            isEndpt: isEndpt
        });
        return gasUsed;
    }
}
