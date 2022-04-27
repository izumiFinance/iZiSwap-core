// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import '../libraries/MulDivMath.sol';

contract TestMulDivMath {
    function getMulDivFloor(uint256 a, uint256 b, uint256 c) external view returns (uint256) {
        return MulDivMath.mulDivFloor(a, b, c);
    }

    function getGasCostOfMulDivFloor(uint256 a, uint256 b, uint256 c) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        MulDivMath.mulDivFloor(a, b, c);
        return gasBefore - gasleft();
    }

    function getMulDivCeil(uint256 a, uint256 b, uint256 c) external view returns (uint256) {
        return MulDivMath.mulDivCeil(a, b, c);
    }

    function getGasCostOfMulDivCeil(uint256 a, uint256 b, uint256 c) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        MulDivMath.mulDivCeil(a, b, c);
        return gasBefore - gasleft();
    }
}
