pragma solidity ^0.8.4;

interface IiZiSwapFlashCallback {

    /// @notice Called to `msg.sender` after transferring to the recipient from IiZiSwapPool#flash.
    /// @dev In the implementation you must repay the pool the tokens sent by flash plus the computed fee amounts.
    /// the caller of this method must be address of the corresponding swap pool at which you called flash()
    /// @param feeX The fee amount in tokenX due to the pool by the end of the flash
    /// @param feeY The fee amount in tokenY due to the pool by the end of the flash
    /// @param data Any data passed through by the caller via the flashCallback#flash call
    function flashCallback(
        uint256 feeX,
        uint256 feeY,
        bytes calldata data
    ) external;

}
