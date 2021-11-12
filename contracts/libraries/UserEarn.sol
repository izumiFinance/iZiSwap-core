pragma solidity >=0.7.3;
import './LiquidityMath.sol';
import './FullMath.sol';
import './FixedPoint96.sol';

library UserEarn {

    struct Data {
        // uint256 lastSold;
        uint256 lastAccEarn;
        uint256 sellingRemain;
        uint256 sellingDec;
        uint256 earn;
        uint256 earnAssign;
    }
    
    function get(
        mapping(bytes32 => Data) storage self,
        address user,
        int24 pt
    ) internal view returns (UserEarn.Data storage data) {
        data = self[keccak256(abi.encodePacked(user, pt))];
    }

    function update(
        UserEarn.Data storage self,
        uint256 currAccEarn,
        uint160 sqrtPrice_96,
        uint256 totalEarn,
        bool isEarnY
    ) internal returns (uint256 totalEarnRemain) {
        Data memory data = self;
        uint256 earn = currAccEarn - data.lastAccEarn;
        if (earn > totalEarn) {
            earn = totalEarn;
        }
        uint256 sold;
        if (isEarnY) {
            uint256 l = FullMath.mulDivCeil(earn, FixedPoint96.Q96, sqrtPrice_96);
            sold = FullMath.mulDivCeil(l, FixedPoint96.Q96, sqrtPrice_96);
        } else {
            uint256 l = FullMath.mulDivCeil(earn, sqrtPrice_96, FixedPoint96.Q96);
            sold = FullMath.mulDivCeil(l, sqrtPrice_96, FixedPoint96.Q96);
        }
        if (sold > data.sellingRemain) {
            sold = data.sellingRemain;
            if (isEarnY) {
                uint256 l = FullMath.mulDivFloor(sold, sqrtPrice_96, FixedPoint96.Q96);
                earn = FullMath.mulDivFloor(l, sqrtPrice_96, FixedPoint96.Q96);
            } else {
                uint256 l = FullMath.mulDivFloor(sold, FixedPoint96.Q96, sqrtPrice_96);
                earn = FullMath.mulDivFloor(l, FixedPoint96.Q96, sqrtPrice_96);
            }
        }
        data.earn += earn;
        data.sellingRemain -= sold;
        self.lastAccEarn = currAccEarn;
        if (earn > 0) {
            self.earn = data.earn;
        }
        if (sold > 0) {
            self.sellingRemain = data.sellingRemain;
        }
        totalEarnRemain = totalEarn - earn;
    }

    function add(
        UserEarn.Data storage self,
        uint128 delta,
        uint256 currAccEarn,
        uint160 sqrtPrice_96,
        uint256 totalEarn,
        bool isEarnY
    ) internal returns(uint256 totalEarnRemain) {
        totalEarnRemain = update(self, currAccEarn, sqrtPrice_96, totalEarn, isEarnY);
        self.sellingRemain = self.sellingRemain + delta;
    }

    function dec(
        UserEarn.Data storage self,
        uint128 delta,
        uint256 currAccEarn,
        uint160 sqrtPrice_96,
        uint256 totalEarn,
        bool isEarnY
    ) internal returns(uint128 actualDelta, uint256 totalEarnRemain) {
        totalEarnRemain = update(self, currAccEarn, sqrtPrice_96, totalEarn, isEarnY);
        actualDelta = delta;
        if (actualDelta > self.sellingRemain) {
            actualDelta = uint128(self.sellingRemain);
        }
        self.sellingRemain = self.sellingRemain - actualDelta;
        self.sellingDec = self.sellingDec + actualDelta;
    }

}