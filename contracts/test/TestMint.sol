pragma solidity ^0.8.4;

import '../interfaces/IIzumiswapPool.sol';
import '../interfaces/IIzumiswapCallback.sol';
import '../interfaces/IIzumiswapFactory.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestMint is IIzumiswapMintCallback {
    struct MintCallbackData {
        address tokenX;
        address tokenY;
        address payer;
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
        require(success && (data.length == 0 || abi.decode(data, (bool))), 'STF');
    }
    function mintDepositCallback(
        uint256 x, uint256 y, bytes calldata data
    ) external override {
        MintCallbackData memory dt = abi.decode(data, (MintCallbackData));
        if (x > 0) {
            safeTransferFrom(dt.tokenX, dt.payer, msg.sender, x);
        }
        if (y > 0) {
            safeTransferFrom(dt.tokenY, dt.payer, msg.sender, y);
        }
    }
    constructor(address fac) { factory = fac; }
    function pool(address tokenX, address tokenY, uint24 fee) public view returns(address) {
        return IIzumiswapFactory(factory).pool(tokenX, tokenY, fee);
    }
    function mint(
        address tokenX, 
        address tokenY, 
        uint24 fee,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        address miner = msg.sender;
        IIzumiswapPool(poolAddr).mint(
            miner,
            leftPt,
            rightPt,
            liquidDelta,
            abi.encode(MintCallbackData({tokenX: tokenX, tokenY: tokenY, payer: miner}))
        );
    }
}
