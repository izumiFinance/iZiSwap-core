// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.4;

import '../interfaces/IiZiSwapPool.sol';
import '../interfaces/IiZiSwapCallback.sol';
import '../interfaces/IiZiSwapFactory.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestAddLimOrder is IiZiSwapAddLimOrderCallback {

    address public factory;
    function safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 value
    ) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), 'STF');
    }
    
    struct LimCallbackData {
        address tokenX;
        address tokenY;
        uint24 fee;
        address payer;
    }
    function payCallback(
        uint256 x,
        uint256 y,
        bytes calldata data
    ) external override {
        LimCallbackData memory dt = abi.decode(data, (LimCallbackData));
        if (x > 0) {
            safeTransferFrom(dt.tokenX, dt.payer, msg.sender, x);
        }
        if (y > 0) {
            safeTransferFrom(dt.tokenY, dt.payer, msg.sender, y);
        }
    }
    constructor(address fac) { factory = fac; }
    function pool(address tokenX, address tokenY, uint24 fee) public view returns(address) {
        return IiZiSwapFactory(factory).pool(tokenX, tokenY, fee);
    }
    function limOrderKey(address miner, int24 pt) internal pure returns(bytes32) {
        return keccak256(abi.encodePacked(miner, pt));
    }

    function getEarnX(address pool, bytes32 key) private view returns(uint256 lastAccEarn, uint256 sellingRemain, uint256 sellingDesc, uint256 earn, uint256 earnAssign) {
        (lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign) = IiZiSwapPool(pool).userEarnX(key);
    }
    function getEarnX(address pool, address miner, int24 pt) public view returns(uint256 lastAccEarn, uint256 sellingRemain, uint256 sellingDesc, uint256 earn, uint256 earnAssign) {
        (lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign) = getEarnX(pool, limOrderKey(miner, pt));
    }
    function getEarnY(address pool, bytes32 key) private view returns(uint256 lastAccEarn, uint256 sellingRemain, uint256 sellingDesc, uint256 earn, uint256 earnAssign) {
        (lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign) = IiZiSwapPool(pool).userEarnY(key);
    }
    function getEarnY(address pool, address miner, int24 pt) public view returns(uint256 lastAccEarn, uint256 sellingRemain, uint256 sellingDesc, uint256 earn, uint256 earnAssign) {
        (lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign) = getEarnY(pool, limOrderKey(miner, pt));
    }
    
    function getEarn(address pool, address miner, int24 pt, bool sellXEarnY) public view returns(uint256 lastAccEarn, uint256 sellingRemain, uint256 sellingDesc, uint256 earn, uint256 earnAssign) {
        if (sellXEarnY) {
            (lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign) = getEarnY(pool, limOrderKey(miner, pt));
        } else {
            (lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign) = getEarnX(pool, limOrderKey(miner, pt));
        }
    }
    function addLimOrderWithX(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 pt,
        uint128 amountX
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        IiZiSwapPool(poolAddr).addLimOrderWithX(
            msg.sender, pt, amountX,
            abi.encode(LimCallbackData({tokenX: tokenX, tokenY: tokenY, fee: fee, payer: msg.sender}))
        );
    }
    function addLimOrderWithY(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 pt,
        uint128 amountY
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        IiZiSwapPool(poolAddr).addLimOrderWithY(
            msg.sender, pt, amountY,
            abi.encode(LimCallbackData({tokenX: tokenX, tokenY: tokenY, fee: fee, payer: msg.sender}))
        );
    }
    
}