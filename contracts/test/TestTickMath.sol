// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import '../libraries/LogPowMath.sol';

contract TestLogPowMath {
    function getSqrtPrice(int24 point) external pure returns (uint160) {
        return LogPowMath.getSqrtPrice(point);
    }

    function getGasCostOfGetSqrtPrice(int24 point) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        LogPowMath.getSqrtPrice(point);
        return gasBefore - gasleft();
    }

    function getLogSqrtPriceFloor(uint160 sqrtPrice_96) external pure returns (int24) {
        return LogPowMath.getLogSqrtPriceFloor(sqrtPrice_96);
    }

    function getGasCostOfGetLogSqrtPriceFloor(uint160 sqrtPrice_96) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        LogPowMath.getLogSqrtPriceFloor(sqrtPrice_96);
        return gasBefore - gasleft();
    }

    function getLogSqrtPriceFU(uint160 sqrtPrice_96) external pure returns (int24, int24) {
        return LogPowMath.getLogSqrtPriceFU(sqrtPrice_96);
    }

}
