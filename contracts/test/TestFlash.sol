// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import '../interfaces/IiZiSwapPool.sol';
import '../interfaces/IiZiSwapFlashCallback.sol';
import '../interfaces/IiZiSwapFactory.sol';

import "hardhat/console.sol";
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestFlash is IiZiSwapFlashCallback {
    struct FlashCallbackData {
        address token0;
        address token1;
        address payer;
        uint24 fee;
        uint256 amount0;
        uint256 amount1;
        bool enoughX;
        bool enoughY;
    }

    uint256 token0BalanceBefore;
    uint256 token1BalanceBefore;

    address public factory;

    function safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 value
    ) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        console.log("transfer value: %s", value);
        require(success && (data.length == 0 || abi.decode(data, (bool))), 'STF');
    }

    function pool(address tokenX, address tokenY, uint24 fee) public view returns(address) {
        return IiZiSwapFactory(factory).pool(tokenX, tokenY, fee);
    }

    function flashCallback(
        uint256 feeX,
        uint256 feeY,
        bytes calldata data
    ) external override {
        FlashCallbackData memory dt = abi.decode(data, (FlashCallbackData));
        require(pool(dt.token0, dt.token1, dt.fee) == msg.sender, "sp");

        uint256 token0BalanceAfter = IERC20(dt.token0).balanceOf(dt.payer);
        uint256 token1BalanceAfter = IERC20(dt.token1).balanceOf(dt.payer);

        require(token0BalanceAfter == token0BalanceBefore + dt.amount0, "not borrow enough tokenX");
        require(token1BalanceAfter == token1BalanceBefore + dt.amount1, "not borrow enough tokenY");

        safeTransferFrom(dt.token1, dt.payer, msg.sender, feeY);
        safeTransferFrom(dt.token0, dt.payer, msg.sender, feeX);

        if (dt.enoughY){
            safeTransferFrom(dt.token1, dt.payer, msg.sender, dt.amount1);
        } else {
            safeTransferFrom(dt.token1, dt.payer, msg.sender, dt.amount1 -1);
        }

        if (dt.enoughX){
            safeTransferFrom(dt.token0, dt.payer, msg.sender, dt.amount0);
        } else {
            safeTransferFrom(dt.token0, dt.payer, msg.sender, dt.amount0 - 1);
        }
    }
    
    constructor(address fac) { factory = fac; }

    function flash(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint256 amountX,
        uint256 amountY
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        token0BalanceBefore = IERC20(tokenX).balanceOf(msg.sender);
        token1BalanceBefore = IERC20(tokenY).balanceOf(msg.sender);
        IiZiSwapPool(poolAddr).flash(
            payer, amountX, amountY,
            abi.encode(FlashCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer, amount0: amountX, amount1: amountY, enoughX: true, enoughY: true}))
        );
    }

    function flashNotPayBackEnoughX(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint256 amountX,
        uint256 amountY
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        token0BalanceBefore = IERC20(tokenX).balanceOf(msg.sender);
        token1BalanceBefore = IERC20(tokenY).balanceOf(msg.sender);
        IiZiSwapPool(poolAddr).flash(
            payer, amountX, amountY,
            abi.encode(FlashCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer, amount0: amountX, amount1: amountY, enoughX: false, enoughY: true}))
        );
    }

    function flashNotPayBackEnoughY(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint256 amountX,
        uint256 amountY
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        token0BalanceBefore = IERC20(tokenX).balanceOf(msg.sender);
        token1BalanceBefore = IERC20(tokenY).balanceOf(msg.sender);
        IiZiSwapPool(poolAddr).flash(
            payer, amountX, amountY,
            abi.encode(FlashCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer, amount0: amountX, amount1: amountY, enoughX: true, enoughY: false}))
        );
    }

}