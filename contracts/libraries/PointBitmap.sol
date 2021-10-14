// TODO: must modify!
// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.5.0;

import './BitMath.sol';

/// @title Packed point initialized state library
/// @notice Stores a packed mapping of point index to its initialized state
/// @dev The mapping uses int16 for keys since points are represented as int24 and there are 256 (2^8) values per word.
library PointBitmap {
    /// @notice Computes the position in the mapping where the initialized bit for a point lives
    /// @param point The point for which to compute the position
    /// @return wordPos The key in the mapping containing the word in which the bit is stored
    /// @return bitPos The bit position in the word where the flag is stored
    function position(int24 point) private pure returns (int16 wordPos, uint8 bitPos) {
        wordPos = int16(point >> 8);
        bitPos = uint8(uint24(point % 256));
    }

    /// @notice Flips the initialized state for a given point from false to true, or vice versa
    /// @param self The mapping in which to flip the point
    /// @param point The point to flip
    /// @param pointDelta The spacing between usable points
    function flipPoint(
        mapping(int16 => uint256) storage self,
        int24 point,
        int24 pointDelta
    ) internal {
        require(point % pointDelta == 0); // ensure that the point is spaced
        (int16 wordPos, uint8 bitPos) = position(point / pointDelta);
        uint256 mask = 1 << bitPos;
        self[wordPos] ^= mask;
    }

    function setOne(
        mapping(int16 => uint256) storage self,
        int24 point,
        int24 pointDelta
    ) internal {
        require(point % pointDelta == 0);
        (int16 wordPos, uint8 bitPos) = position(point / pointDelta);
        uint256 mask = 1 << bitPos;
        self[wordPos] |= mask;
    }

    function setZero(
        mapping(int16 => uint256) storage self,
        int24 point,
        int24 pointDelta
    ) internal {
        require(point % pointDelta == 0);
        (int16 wordPos, uint8 bitPos) = position(point / pointDelta);
        uint256 mask = ~(1 << bitPos);
        self[wordPos] &= mask;
    }

    /// @notice Returns the next initialized point contained in the same word (or adjacent word) as the point that is either
    /// to the left (less than or equal to) or right (greater than) of the given point
    /// @param self The mapping in which to compute the next initialized point
    /// @param point The starting point
    /// @param pointDelta The spacing between usable points
    /// @param lte Whether to search for the next initialized point to the left (less than or equal to the starting point)
    /// @return next The next initialized or uninitialized point up to 256 points away from the current point
    /// @return initialized Whether the next point is initialized, as the function only searches within up to 256 points
    function nextInitializedpointWithinOneWord(
        mapping(int16 => uint256) storage self,
        int24 point,
        int24 pointDelta,
        bool lte
    ) internal view returns (int24 next, bool initialized) {
        int24 compressed = point / pointDelta;
        if (point < 0 && point % pointDelta != 0) compressed--; // round towards negative infinity

        if (lte) {
            (int16 wordPos, uint8 bitPos) = position(compressed);
            // all the 1s at or to the right of the current bitPos
            uint256 mask = (1 << bitPos) - 1 + (1 << bitPos);
            uint256 masked = self[wordPos] & mask;

            // if there are no initialized points to the right of or at the current point, return rightmost in the word
            initialized = masked != 0;
            // overflow/underflow is possible, but prevented externally by limiting both pointDelta and point
            next = initialized
                ? (compressed - int24(uint24(bitPos - BitMath.mostSignificantBit(masked)))) * pointDelta
                : (compressed - int24(uint24(bitPos))) * pointDelta;
        } else {
            // start from the word of the next point, since the current point state doesn't matter
            (int16 wordPos, uint8 bitPos) = position(compressed + 1);
            // all the 1s at or to the left of the bitPos
            uint256 mask = ~((1 << bitPos) - 1);
            uint256 masked = self[wordPos] & mask;

            // if there are no initialized points to the left of the current point, return leftmost in the word
            initialized = masked != 0;
            // overflow/underflow is possible, but prevented externally by limiting both pointDelta and point
            next = initialized
                ? (compressed + 1 + int24(uint24(BitMath.leastSignificantBit(masked) - bitPos))) * pointDelta
                : (compressed + 1 + int24(uint24(type(uint8).max - bitPos))) * pointDelta;
        }
    }
}
