pragma solidity =0.8.4;

import '../interfaces/IIzumiswapPool.sol';
import '../interfaces/IIzumiswapCallback.sol';
import '../interfaces/IIzumiswapFactory.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestAddLimOrder is IIzumiswapAddLimOrderCallback {

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
    function payCallback(
        address token,
        address payer,
        uint256 amount
    ) external override {
        if (amount > 0) {
            safeTransferFrom(token, payer, msg.sender, amount);
        }
    }
    constructor(address fac) { factory = fac; }
    function pool(address tokenX, address tokenY, uint24 fee) public view returns(address) {
        return IIzumiswapFactory(factory).pool(tokenX, tokenY, fee);
    }
    function addLimOrderWithX(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 pt,
        uint128 amountX
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        IIzumiswapPool(poolAddr).addLimOrderWithX(msg.sender, pt, amountX);
    }
    function addLimOrderWithY(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 pt,
        uint128 amountY
    ) external {
        address poolAddr = pool(tokenX, tokenY, fee);
        IIzumiswapPool(poolAddr).addLimOrderWithY(msg.sender, pt, amountY);
    }
}