// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import '../interfaces/IiZiSwapPool.sol';
import '../interfaces/IiZiSwapCallback.sol';
import '../interfaces/IiZiSwapFactory.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestMint is IiZiSwapMintCallback {
    struct MintCallbackData {
        address tokenX;
        address tokenY;
        uint24 fee;
        address payer;
    }
    address public factory;

    bool public notEnoughX;
    bool public notEnoughY;

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
    function pool(address tokenX, address tokenY, uint24 fee) public view returns(address) {
        return IiZiSwapFactory(factory).pool(tokenX, tokenY, fee);
    }
    function mintDepositCallback(
        uint256 x, uint256 y, bytes calldata data
    ) external override {
        MintCallbackData memory dt = abi.decode(data, (MintCallbackData));
        require(pool(dt.tokenX, dt.tokenY, dt.fee) == msg.sender, "sp");
        if (x > 0) {
            if (!notEnoughX) {
                safeTransferFrom(dt.tokenX, dt.payer, msg.sender, x);
            } else {
                safeTransferFrom(dt.tokenX, dt.payer, msg.sender, x - 1);
            }
        }
        if (y > 0) {
            if (!notEnoughY) {
                safeTransferFrom(dt.tokenY, dt.payer, msg.sender, y);
            } else {
                safeTransferFrom(dt.tokenY, dt.payer, msg.sender, y - 1);
            }
        }
    }
    constructor(address fac) { 
        factory = fac;
        notEnoughX = false;
        notEnoughY = false;
    }

    function setNotEnoughX(bool value) public {
        notEnoughX = value;
    }
    function setNotEnoughY(bool value) public {
        notEnoughY = value;
    }
    
    function mint(
        address tokenX, 
        address tokenY, 
        uint24 fee,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta
    ) external {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address miner = msg.sender;
        IiZiSwapPool(poolAddr).mint(
            miner,
            leftPt,
            rightPt,
            liquidDelta,
            abi.encode(MintCallbackData({tokenX: tokenX, tokenY: tokenY, fee: fee, payer: miner}))
        );
    }
    
    function liquidities(
        address tokenX, address tokenY, uint24 fee, int24 pl, int24 pr
    ) external view returns(
        uint128 liquidity,
        uint256 lastFeeScaleX_128,
        uint256 lastFeeScaleY_128,
        uint256 tokenOwedX,
        uint256 tokenOwedY
    ) {
        require(tokenX < tokenY, "x<y");
        address poolAddr = pool(tokenX, tokenY, fee);
        address miner = msg.sender;
        return IiZiSwapPool(poolAddr).liquidity(keccak256(abi.encodePacked(miner, pl, pr)));
    }

    function liquiditySnapshot(address tokenX, address tokenY, uint24 fee, int24 leftPoint, int24 rightPoint) external view returns(int128[] memory deltaLiquidities) {
        address poolAddr = pool(tokenX, tokenY, fee);
        return IiZiSwapPool(poolAddr).liquiditySnapshot(leftPoint, rightPoint);
    }
}
