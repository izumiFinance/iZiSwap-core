
pragma solidity ^0.8.4;

library FullMath {

    // compute res = floor(a * b / c), assuming res < 2^256
    function mulDivFloor(
        uint256 a,
        uint256 b,
        uint256 c
    ) internal pure returns (uint256 res) {
        
        // let prodMod2_256 = a * b % 2^256
        uint256 prodMod2_256; 
        // let prodDiv2_256 = a * b / 2^256
        uint256 prodDiv2_256;
        assembly {
            let prodModM1 := mulmod(a, b, not(0))
            prodMod2_256 := mul(a, b)
            prodDiv2_256 := sub(sub(prodModM1, prodMod2_256), lt(prodModM1, prodMod2_256))
        }

        if (prodDiv2_256 == 0) {
            require(c > 0);
            assembly {
                res := div(prodMod2_256, c)
            }
            return res;
        }

        // we should ensure that a * b /c < 2^256 before calling
        require(c > prodDiv2_256);

        // cInv * c = 1 (mod 2^4)
        uint256 cInv = (3 * c) ^ 2;
        cInv *= 2 - c * cInv; // shift to 2^8
        cInv *= 2 - c * cInv; // shift to 2^16
        cInv *= 2 - c * cInv; // shift to 2^32
        cInv *= 2 - c * cInv; // shift to 2^64
        cInv *= 2 - c * cInv; // shift to 2^128
        cInv *= 2 - c * cInv; // shift to 2^256
        // c * cInv = 1 (mod 2^256)

        uint256 resMod;
        assembly {
            resMod := mulmod(a, b, c)
        }
        // a * b - resMod
        assembly {
            prodDiv2_256 := sub(prodDiv2_256, gt(resMod, prodMod2_256))
            prodMod2_256 := sub(prodMod2_256, resMod)
        }

        // a * b / lowbit
        uint256 lowbit = ((~c) + 1) & c;
        assembly {
            c := div(c, lowbit)
        }

        // a * b / lowbit
        assembly {
            prodMod2_256 := div(prodMod2_256, lowbit)
        }
        assembly {
            lowbit := add(div(sub(0, lowbit), lowbit), 1)
        }
        prodMod2_256 |= prodDiv2_256 * lowbit;

        res = prodMod2_256 * cInv;
    }

    // compute res = ceil(a * b / c), assuming res < 2^256
    function mulDivCeil(
        uint256 a,
        uint256 b,
        uint256 c
    ) internal pure returns (uint256 res) {
        res = mulDivFloor(a, b, c);
        if (mulmod(a, b, c) > 0) {
            require(res < type(uint256).max);
            res++;
        }
    }
}
