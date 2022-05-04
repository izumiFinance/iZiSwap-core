const {
    expect
} = require("chai");
const {
    ethers
} = require("hardhat");

const BigNumber = require('bignumber.js');

const {
    getPoolParts,
    addLiquidity
} = require('../funcs');
var tokenX;
var tokenY;

async function getToken() {

    // deploy token
    const tokenFactory = await ethers.getContractFactory("Token")
    tokenX = await tokenFactory.deploy('a', 'a');
    await tokenX.deployed();
    tokenY = await tokenFactory.deploy('b', 'b');
    await tokenY.deployed();

    txAddr = tokenX.address.toLowerCase();
    tyAddr = tokenY.address.toLowerCase();

    if (txAddr > tyAddr) {
        tmpAddr = tyAddr;
        tyAddr = txAddr;
        txAddr = tmpAddr;

        tmpToken = tokenY;
        tokenY = tokenX;
        tokenX = tmpToken;
    }

    return [tokenX, tokenY];
}


async function addLimOrderWithY(tokenX, tokenY, seller, testAddLimOrder, amountY, point) {
    await tokenY.transfer(seller.address, amountY);
    await tokenY.connect(seller).approve(testAddLimOrder.address, amountY);
    await testAddLimOrder.connect(seller).addLimOrderWithY(
        tokenX.address, tokenY.address, 3000, point, amountY
    );
}
async function addLimOrderWithX(tokenX, tokenY, seller, testAddLimOrder, amountX, point) {
    await tokenX.transfer(seller.address, amountX);
    await tokenX.connect(seller).approve(testAddLimOrder.address, amountX);
    await testAddLimOrder.connect(seller).addLimOrderWithX(
        tokenX.address, tokenY.address, 3000, point, amountX
    );
}

describe("view functions", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var poolAddr;
    var pool;
    var testMint;
    var testSwap;
    var q128;
    var q256;
    var expectFeeScaleX, expectFeeScaleX;
    var testAddLimOrder;
    var logPowMath;
    beforeEach(async function () {
        [signer, miner1, miner2, miner3, miner4, trader, seller1, seller2, receiver] = await ethers.getSigners();

        const {
            swapX2YModule,
            swapY2XModule,
            liquidityModule,
            limitOrderModule,
            flashModule
        } = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, -8000);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);

        const TestLogPowMath = await ethers.getContractFactory('TestLogPowMath');
        logPowMath = await TestLogPowMath.deploy();

        await tokenX.mint(miner1.address, '1000000000000000000000000000000');
        await tokenY.mint(miner1.address, '1000000000000000000000000000000');
        await tokenX.mint(miner2.address, '1000000000000000000000000000000');
        await tokenY.mint(miner2.address, '1000000000000000000000000000000');

        await tokenX.mint(miner3.address, '1000000000000000000000000000000');
        await tokenY.mint(miner3.address, '1000000000000000000000000000000');
        await tokenX.mint(miner4.address, '1000000000000000000000000000000');
        await tokenY.mint(miner4.address, '1000000000000000000000000000000');

        await tokenX.mint(trader.address, '1000000000000000000000000000000');
        await tokenY.mint(trader.address, '1000000000000000000000000000000');
        await tokenX.mint(seller1.address, '1000000000000000000000000000000');
        await tokenY.mint(seller1.address, '1000000000000000000000000000000');
        await tokenX.mint(seller2.address, '1000000000000000000000000000000');
        await tokenY.mint(seller2.address, '1000000000000000000000000000000');

        // test mint
        const testMintFactory = await ethers.getContractFactory("TestMint");
        testMint = await testMintFactory.deploy(factory.address);
        await testMint.deployed();

        const testSwapFactory = await ethers.getContractFactory('TestSwap');
        testSwap = await testSwapFactory.deploy(factory.address);
        await testSwap.deployed();

        const getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);
        expect(getPoolAddr.toLowerCase()).to.equal(poolAddr.toLowerCase());

        const poolFactory = await ethers.getContractFactory('iZiSwapPool');
        pool = await poolFactory.attach(poolAddr);

        await tokenX.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner3).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner3).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner4).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner4).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenX.connect(seller1).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(seller1).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenX.connect(seller2).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(seller2).approve(testAddLimOrder.address, '1000000000000000000000000000000');

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

    });

    it("liquidity and limitOrder snapshot", async function () {

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -12000, -5000, '1000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -8000, 2000, '2000000');
        await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 50, 10050, '1000000');
        await addLiquidity(testMint, miner4, tokenX, tokenY, 3000, 9000, 12000, '2000000');
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', -11000);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '200000000000000000000', -8000);
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '150000000000000000000', 350);
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '50000000000000000000', 9000);
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '80000000000000000000', 10050);
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '70000000000000000000', 10100);

        const liquiditySnapshot1 = await pool.liquiditySnapshot(-12000, -11900);
        expect(liquiditySnapshot1.length).to.equal(2);
        expect(liquiditySnapshot1[0].toString()).to.equal('1000000');
        expect(liquiditySnapshot1[1].toString()).to.equal('0');
        const liquiditySnapshot2 = await pool.liquiditySnapshot(-5000, -4900);
        expect(liquiditySnapshot2[0].toString()).to.equal('-1000000');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -12000, -5000, '1000000');
        const liquiditySnapshot3 = await pool.liquiditySnapshot(-12000, -11900);
        expect(liquiditySnapshot3[0].toString()).to.equal('2000000');

        const liquiditySnapshot4 = await pool.liquiditySnapshot(0, 5000);
        expect(liquiditySnapshot4.length).to.equal(100);
        expect(liquiditySnapshot4[1].toString()).to.equal('1000000');

        const limitOrderSnapshot1 = await pool.limitOrderSnapshot(-11000, -10000);
        console.log(limitOrderSnapshot1[0])
        expect(limitOrderSnapshot1.length).to.equal(20);
        expect(limitOrderSnapshot1[0].sellingY.toString()).to.equal('100000000000000000000');
    
        const limitOrderSnapshot2 = await pool.limitOrderSnapshot(8950, 10000);
        expect(limitOrderSnapshot2.length).to.equal(21);
        expect(limitOrderSnapshot2[1].sellingX.toString()).to.equal('50000000000000000000');

        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', -11000);
        const limitOrderSnapshot3 = await pool.limitOrderSnapshot(-11000, -10000);
        expect(limitOrderSnapshot3[0].sellingY.toString()).to.equal('200000000000000000000');
    
    });

});