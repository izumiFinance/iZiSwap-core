// TODO may need modify
pragma solidity >=0.7.3;

interface IIzumiswapMintCallback {

    function mintDepositCallback(
        uint256 x,
        uint256 y,
        bytes calldata data
    ) external;

}

interface IIzumiswapSwapCallback {
    function swapY2XCallback(
        uint256 y,
        bytes calldata data
    ) external;
    function swapX2YCallback(
        uint256 x,
        bytes calldata data
    ) external;
}

interface IIzumiswapAddLimOrderCallback {
    function payCallback(
        address token,
        address payer,
        uint256 amount
    ) external;
}