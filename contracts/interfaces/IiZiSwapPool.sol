// TODO may need modify
pragma solidity >=0.7.3;

interface IiZiSwapPool {

    function liquidities(bytes32 key)
        external
        view
        returns (
            uint128 liquidity,
            uint256 lastFeeScaleX_128,
            uint256 lastFeeScaleY_128,
            uint256 remainFeeX,
            uint256 remainFeeY
        );
    function userEarnX(bytes32 key)
        external
        view
        returns (
            uint256 lastAccEarn,
            uint256 sellingRemain,
            uint256 sellingDec,
            uint256 earn,
            uint256 earnAssign
        );
    function userEarnY(bytes32 key)
        external
        view
        returns (
            uint256 lastAccEarn,
            uint256 sellingRemain,
            uint256 sellingDec,
            uint256 earn,
            uint256 earnAssign
        );
    function assignLimOrderEarnY(
        int24 pt,
        uint256 assignY
    ) external returns(uint256 actualAssignY);
    function assignLimOrderEarnX(
        int24 pt,
        uint256 assignX
    ) external returns(uint256 actualAssignX);
    function decLimOrderWithX(
        int24 pt,
        uint128 deltaX
    ) external returns (uint128 actualDeltaX);
    
    
    function decLimOrderWithY(
        int24 pt,
        uint128 deltaY
    ) external returns (uint128 actualDeltaY);
    
    
    function addLimOrderWithX(
        address recipient,
        int24 pt,
        uint128 amountX,
        bytes calldata data
    ) external returns (uint128 orderX, uint256 acquireY);

    function addLimOrderWithY(
        address recipient,
        int24 pt,
        uint128 amountY,
        bytes calldata data
    ) external returns (uint128 orderY, uint256 acquireX);

    function collectLimOrder(
        address recipient, int24 pt, uint256 collectDec, uint256 collectEarn, bool isEarnY
    ) external returns(uint256 actualCollectDec, uint256 actualCollectEarn);

    function mint(
        address minter,
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta,
        bytes calldata data
    ) external returns (uint128 amountX, uint128 amountY);
    function burn(
        int24 leftPt,
        int24 rightPt,
        uint128 liquidDelta
    ) external returns (uint256 amountX, uint256 amountY);
    function collect(
        address recipient,
        int24 leftPt,
        int24 rightPt,
        uint256 amountXLim,
        uint256 amountYLim
    ) external returns (uint256 actualAmountX, uint256 actualAmountY);
    function swapY2X(
        address recipient,
        uint128 amount,
        int24 highPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    function swapY2XDesireX(
        address recipient,
        uint128 desireX,
        int24 highPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    
    function swapX2Y(
        address recipient,
        uint128 amount,
        int24 lowPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    
    function swapX2YDesireY(
        address recipient,
        uint128 desireY,
        int24 highPt,
        bytes calldata data
    ) external returns (uint256 amountX, uint256 amountY);
    
    function state()
        external view
        returns(
            uint160 sqrtPrice_96,
            int24 currPt,
            uint256 currX,
            uint256 currY,
            uint128 liquidity,
            bool allX,
            uint16 observationCurrentIndex,
            uint16 observationQueueLen,
            uint16 observationNextQueueLen,
            bool locked
        );
    function sqrtRate_96() external view returns (uint160);
    function limitOrderData(int24 pt)
        external view
        returns(
            uint256 sellingX,
            uint256 accEarnX,
            uint256 sellingY,
            uint256 accEarnY,
            uint256 earnX,
            uint256 earnY
        );
    function statusVal(int24) external returns(int24 val);
}