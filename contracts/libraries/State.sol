// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

struct State {
        // a 96 fixpoing number describe the sqrt value of current price(tokenX/tokenY)
        uint160 sqrtPrice_96;
        // The current point of the pool, 1.0001 ^ currentPoint = price
        int24 currentPoint;
        // amount of tokenX on the currentPoint, this value is meaningless if allX is true
        uint256 currX;
        // amount of tokenY on the currentPoint, this value is meaningless if allX is true
        uint256 currY;
        // liquidity on the currentPoint (currX * sqrtPrice + currY / sqrtPrice)
        uint128 liquidity;
        // whether there is no tokenY on the currentPoint
        bool allX;
        // The index of the last oracle observation that was written,
        uint16 observationCurrentIndex;
        // The current maximum number of observations stored in the pool,
        uint16 observationQueueLen;
        // The next maximum number of observations, to be updated when the observation.
        uint16 observationNextQueueLen;
        // whether the pool is locked (only used for checking reentrance)
        bool locked;
}