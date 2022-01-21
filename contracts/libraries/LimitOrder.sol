// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

library LimitOrder {
    struct Data {
        uint256 sellingX;
        uint256 accEarnX;
        uint256 sellingY;
        uint256 accEarnY;
        uint256 earnX;
        uint256 earnY;
    }
}