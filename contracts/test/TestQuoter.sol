pragma solidity ^0.8.4;

import '../interfaces/IIzumiswapPool.sol';
import '../interfaces/IIzumiswapCallback.sol';
import '../interfaces/IIzumiswapFactory.sol';

import "hardhat/console.sol";
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestQuoter is IIzumiswapSwapCallback {
    struct SwapCallbackData {
        // amount of token0 is input param
        address token0;
        // amount of token1 is calculated param
        address token1;
        address payer;
        uint24 fee;
    }
    uint256 public amount;
    address public factory;
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
            assembly {  
                let ptr := mload(0x40)
                mstore(ptr, y)
                revert(ptr, 32)
            }
        } else {
            // token0 is y, amount of token0 is input param
            // called from swapY2X(...)
            assembly {  
                let ptr := mload(0x40)
                mstore(ptr, x)
                revert(ptr, 32)
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
            assembly {  
                let ptr := mload(0x40)
                mstore(ptr, y)
                revert(ptr, 32)
            }
        } else {
            // token1 is x, amount of token1 is calculated param
            // called from swapX2YDesireY(...)
            assembly {  
                let ptr := mload(0x40)
                mstore(ptr, y)
                revert(ptr, 32)
            }
        }
    }
    function pool(address tokenX, address tokenY, uint24 fee) public view returns(address) {
        return IIzumiswapFactory(factory).pool(tokenX, tokenY, fee);
    }
    constructor(address fac) {
        factory = fac;
    }

    function parseRevertReason(bytes memory reason) private returns (uint256) {
        if (reason.length != 32) {
            if (reason.length < 68) revert('Unexpected error');
            assembly {
                reason := add(reason, 0x04)
            }
            revert(abi.decode(reason, (string)));
        }
        amount = abi.decode(reason, (uint256)); 
        return amount;
    }

    function swapY2X(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 amount,
        int24 highPt
    ) public returns (uint256) {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        try
            IIzumiswapPool(poolAddr).swapY2X(
                payer, amount, highPt,
                abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer}))
            )
        {} catch (bytes memory reason) {
            return parseRevertReason(reason);
        }
    }
    function swapY2XDesireX(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 desireX,
        int24 highPt
    ) public returns (uint256) {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        try
            IIzumiswapPool(poolAddr).swapY2XDesireX(
                payer, desireX, highPt,
                abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer}))
            )
        {} catch (bytes memory reason) {
            return parseRevertReason(reason);
        }
    }
    function swapX2Y(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 amount,
        int24 lowPt
    ) public returns (uint256) {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        try
            IIzumiswapPool(poolAddr).swapX2Y(
                payer, amount, lowPt,
                abi.encode(SwapCallbackData({token0: tokenX, token1:tokenY, fee: fee, payer: payer}))
            )
        {} catch (bytes memory reason) {
            return parseRevertReason(reason);
        }
    }
    function swapX2YDesireY(
        address tokenX,
        address tokenY,
        uint24 fee,
        uint128 desireY,
        int24 highPt
    ) public returns (uint256) {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address payer = msg.sender;
        try 
            IIzumiswapPool(poolAddr).swapX2YDesireY(
                payer, desireY, highPt,
                abi.encode(SwapCallbackData({token0: tokenY, token1:tokenX, fee: fee, payer: payer}))
            )
        {} catch (bytes memory reason) {
            return parseRevertReason(reason);
        }
    }
}