pragma solidity >=0.7.3;

import './LiquidityMath.sol';
import './FullMath.sol';
import './FixedPoint128.sol';

library Liquidity {
    struct Data {
        uint128 liquidity;
        uint256 lastFeeScaleX_128;
        uint256 lastFeeScaleY_128;
        uint256 remainFeeX;
        uint256 remainFeeY;
    }
    
    // TODO: may need modify
    function get(
        mapping(bytes32 => Data) storage self,
        address minter,
        int24 tl,
        int24 tr
    ) internal view returns (Liquidity.Data storage data) {
        data = self[keccak256(abi.encodePacked(minter, tl, tr))];
    }

    // TODO: may need modity
    function update(
        Liquidity.Data storage self,
        int128 delta,
        uint256 feeScaleX_128,
        uint256 feeScaleY_128
    ) internal {
        Data memory data = self;
        uint128 liquidity;
        if (delta == 0) {
            require(data.liquidity > 0, "L>0");
            liquidity = data.liquidity;
        } else {
            liquidity = LiquidityMath.addDelta(data.liquidity, delta);
        }
        uint128 feeX = uint128(
            FullMath.mulDiv(feeScaleX_128 - data.lastFeeScaleX_128, data.liquidity, FixedPoint128.Q128)
        );
        uint128 feeY = uint128(
            FullMath.mulDiv(feeScaleY_128 - data.lastFeeScaleY_128, data.liquidity, FixedPoint128.Q128)
        );
        data.liquidity = liquidity;

        // update the position
        if (delta != 0) self.liquidity = liquidity;
        self.lastFeeScaleX_128 = feeScaleX_128;
        self.lastFeeScaleY_128 = feeScaleY_128;
        if (feeX > 0 || feeY > 0) {
            // need to withdraw before overflow
            self.remainFeeX += feeX;
            self.remainFeeY += feeY;
        }
    }
}