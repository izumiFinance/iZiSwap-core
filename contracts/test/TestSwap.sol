pragma solidity ^0.8.4;

import '../interfaces/IIzumiswapPool.sol';
import '../interfaces/IIzumiswapCallback.sol';
import '../interfaces/IIzumiswapFactory.sol';

import "hardhat/console.sol";
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestSwap is IIzumiswapSwapCallback {
    struct SwapCallbackData {
        // amount of token0 is input param
        address token0;
        // amount of token1 is calculated param
        address token1;
        address payer;
        uint24 fee;
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
        return IIzumiswapFactory(factory).pool(tokenX, tokenY, fee);
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
            safeTransferFrom(dt.token1, dt.payer, msg.sender, y);
        } else {
            // token0 is y, amount of token0 is input param
            // called from swapY2X(...)
            safeTransferFrom(dt.token0, dt.payer, msg.sender, y);
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
            safeTransferFrom(dt.token0, dt.payer, msg.sender, x);
        } else {
            // token1 is x, amount of token1 is calculated param
            // called from swapX2YDesireY(...)
            safeTransferFrom(dt.token1, dt.payer, msg.sender, x);
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
        IIzumiswapPool(poolAddr).swapY2X(
            payer, amount, highPt,
            abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer}))
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
        IIzumiswapPool(poolAddr).swapY2XDesireX(
            payer, desireX, highPt,
            abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer}))
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
        IIzumiswapPool(poolAddr).swapX2Y(
            payer, amount, lowPt,
            abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer}))
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
        IIzumiswapPool(poolAddr).swapX2YDesireY(
            payer, desireY, highPt,
            abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer}))
        );
    }
}