// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import '../interfaces/IiZiSwapPool.sol';
import '../interfaces/IiZiSwapCallback.sol';
import '../interfaces/IiZiSwapFactory.sol';

import "hardhat/console.sol";
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestSwap is IiZiSwapCallback {
    struct SwapCallbackData {
        // amount of token0 is input param
        address token0;
        // amount of token1 is calculated param
        address token1;
        address payer;
        uint24 fee;
        bool enoughX;
        bool enoughY;
    }

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
    function swapY2XCallback(
        uint256 x,
        uint256 y,
        bytes calldata data
    ) external override {
        SwapCallbackData memory dt = abi.decode(data, (SwapCallbackData));
        require(pool(dt.token0, dt.token1, dt.fee) == msg.sender, "sp");
        if (dt.token0 < dt.token1) {
            // token1 is y, amount of token1 is calculated
            // called from swapY2XDesireX(...)
            if (dt.enoughY) {
                safeTransferFrom(dt.token1, dt.payer, msg.sender, y);
            } else {
                safeTransferFrom(dt.token1, dt.payer, msg.sender, y-1);
            }
        } else {
            // token0 is y, amount of token0 is input param
            // called from swapY2X(...)
            if (dt.enoughY) {
                safeTransferFrom(dt.token0, dt.payer, msg.sender, y);
            } else {
                safeTransferFrom(dt.token0, dt.payer, msg.sender, y-1);
            }
        }
    }

    function swapX2YCallback(
        uint256 x,
        uint256 y,
        bytes calldata data
    ) external override {
        SwapCallbackData memory dt = abi.decode(data, (SwapCallbackData));
        require(pool(dt.token0, dt.token1, dt.fee) == msg.sender, "sp");
        if (dt.token0 < dt.token1) {
            // token0 is x, amount of token0 is input param
            // called from swapX2Y(...)
            if (dt.enoughX) {
                safeTransferFrom(dt.token0, dt.payer, msg.sender, x);
            } else {
                safeTransferFrom(dt.token0, dt.payer, msg.sender, x-1);
            }
        } else {
            // token1 is x, amount of token1 is calculated param
            // called from swapX2YDesireY(...)
            if (dt.enoughX) {
                safeTransferFrom(dt.token1, dt.payer, msg.sender, x);
            } else {
                safeTransferFrom(dt.token1, dt.payer, msg.sender, x-1);
            }
        }
    }
    
    constructor(address fac) { factory = fac; }

    function swapY2X(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 amount,
        int24 highPt
    ) external {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapY2X(
            payer, amount, highPt,
            abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer, enoughX: true, enoughY: true}))
        );
    }

    function swapY2XNotPayEnough(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 amount,
        int24 highPt
    ) external {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapY2X(
            payer, amount, highPt,
            abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer, enoughX: false, enoughY: false}))
        );
    }
    
    function swapY2XDesireX(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 desireX,
        int24 highPt
    ) external {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapY2XDesireX(
            payer, desireX, highPt,
            abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer, enoughX: true, enoughY: true}))
        );
    }

    function swapY2XDesireXNotPayEnough(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 desireX,
        int24 highPt
    ) external {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapY2XDesireX(
            payer, desireX, highPt,
            abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer, enoughX: false, enoughY: false}))
        );
    }
    
    
    function swapX2Y(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 amount,
        int24 lowPt
    ) external {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapX2Y(
            payer, amount, lowPt,
            abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer, enoughX: true, enoughY: true}))
        );
    }

    function swapX2YNotPayEnough(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 amount,
        int24 lowPt
    ) external {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapX2Y(
            payer, amount, lowPt,
            abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer, enoughX: false, enoughY: false}))
        );
    }
    
    function swapX2YDesireY(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 desireY,
        int24 highPt
    ) external {
        require(tokenX < tokenY, "x<y");
        console.log("curr calling address: %s", address(this));
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapX2YDesireY(
            payer, desireY, highPt,
            abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer, enoughX: true, enoughY: true}))
        );
    }

     function swapX2YDesireYNotPayEnough(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 desireY,
        int24 highPt
    ) external {
        require(tokenX < tokenY, "x<y");
        console.log("curr calling address: %s", address(this));
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        IiZiSwapPool(poolAddr).swapX2YDesireY(
            payer, desireY, highPt,
            abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer, enoughX: false, enoughY: false}))
        );
    }
}