// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

struct State {
        uint160 sqrtPrice_96;
        int24 currentPoint;
        uint256 currX;
        uint256 currY;
        // liquidity from currPt to right
        uint128 liquidity;
        bool allX;

        uint16 observationCurrentIndex;
        uint16 observationQueueLen;
        uint16 observationNextQueueLen;
        bool locked;
}