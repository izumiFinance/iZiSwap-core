pragma solidity ^0.8.4;

interface IiZiSwapFactory {

    /// @notice emit when successfuly create a new pool (calling iZiSwapFactory#newPool)
    /// @param tokenX address of erc-20 tokenX
    /// @param tokenY address of erc-20 tokenY
    /// @param fee fee amount of swap (3000 means 0.3%)
    /// @param pointDelta minimum number of distance between initialized or limitorder points
    /// @param pool address of swap pool
    event NewPool(
        address indexed tokenX,
        address indexed tokenY,
        uint24 indexed fee,
        uint24 pointDelta,
        address pool
    );

    /// @notice module to support swap from tokenX to tokenY
    /// @return swapX2YModule address
    function swapX2YModule() external returns (address);

    /// @notice module to support swap from tokenY to tokenX
    /// @return swapY2XModule address
    function swapY2XModule() external returns (address);

    /// @notice module to support mint/burn/collect function of pool
    /// @return mintModule address
    function mintModule() external returns (address);

    /// @notice address of module for user to manage limit orders
    /// @return limitOrderModule address
    function limitOrderModule() external returns (address);

    /// @notice Enables a fee amount with the given pointDelta
    /// @dev Fee amounts may never be removed once enabled
    /// @param fee fee amount (3000 means 0.3%)
    /// @param pointDelta The spacing between points to be enforced for all pools created with the given fee amount
    function enableFeeAmount(uint24 fee, uint24 pointDelta) external;

    /// @notice create a new pool which not exists
    /// @param tokenX address of tokenX
    /// @param tokenY address of tokenY
    /// @param fee fee amount
    /// @param currentPoint initial point (log 1.0001 of price)
    /// @return address of newly created pool
    function newPool(
        address tokenX,
        address tokenY,
        uint24 fee,
        int24 currentPoint
    ) external returns (address);

    /// @notice owner of factory
    /// @return address owner
    function owner() external view returns(address);

    /// @notice charge receiver of all pools
    /// @return address of charge receiver
    function chargeReceiver() external view returns(address);

    /// @notice get pool of (tokenX, tokenY, fee), address(0) for not exists
    /// @param tokenX address of tokenX
    /// @param tokenY address of tokenY
    /// @param fee fee amount
    /// @return address of pool
    function pool(
        address tokenX,
        address tokenY,
        uint24 fee
    ) external view returns(address);

    /// @notice get point delta of a given fee amount
    /// @param fee fee amount
    /// @return pointDelta the point delta
    function fee2pointDelta(uint24 fee) external view returns (int24 pointDelta);

    /// @notice change charge receiver, only owner of factory can call
    /// @param _chargeReceiver address of new receiver
    function modifyChargeReceiver(address _chargeReceiver) external;
}