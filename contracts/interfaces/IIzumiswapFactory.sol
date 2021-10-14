pragma solidity >=0.7.3;

interface IIzumiswapFactory {
    // todo: may be similar
    event NewPool(
        address indexed tokenX,
        address indexed tokenY,
        uint24 indexed fee,
        int24 pointDelta,
        address pool
    );
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