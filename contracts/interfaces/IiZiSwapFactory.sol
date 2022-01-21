pragma solidity ^0.8.4;

interface IiZiSwapFactory {
    // todo: may be similar
    event NewPool(
        address indexed tokenX,
        address indexed tokenY,
        uint24 indexed fee,
        int24 pointDelta,
        address pool
    );
    function swapX2Y() external returns (address);
    function swapY2X() external returns (address);
    function mintModule() external returns (address);
    function enableFeeAmount(uint24 fee, uint24 ptDelta) external;
    function newPool(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 cp
    ) external returns (address);
    function owner() external view returns(address);
    function pool(
        address tokenX,
        address tokenY,
        uint24 fee
    ) external view returns(address);
    function fee2pointDelta(uint24 fee) external view returns (int24 pointDelta);
}