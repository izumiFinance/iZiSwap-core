const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

const {getFeeCharge, getCostXFromYAt, amountAddFee, xInRange, yInRange, getPoolParts, l2x, l2y, getState, addLiquidity, checkLimOrder} = require('../funcs');
const { decryptJsonWallet } = require("@ethersproject/json-wallets");
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

function stringMinus(a, b) {
    return BigNumber(a).minus(b).toFixed(0);
}


async function swapX2Y(testSwap, trader, tokenX, tokenY, fee, amountX, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, fee, amountX, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        costX: stringMinus(traderAmountXBefore, traderAmountXAfter),
        acquireY: stringMinus(traderAmountYAfter, traderAmountYBefore),
    }
}

async function swapX2YDesireY(testSwap, trader, tokenX, tokenY, fee, desireY, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2YDesireY(tokenX.address, tokenY.address, fee, desireY, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        costX: stringMinus(traderAmountXBefore, traderAmountXAfter),
        acquireY: stringMinus(traderAmountYAfter, traderAmountYBefore),
    }
}

async function swapY2X(testSwap, trader, tokenX, tokenY, fee, costY, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, fee, costY, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        acquireX: stringMinus(traderAmountXAfter, traderAmountXBefore),
        costY: stringMinus(traderAmountYBefore, traderAmountYAfter),
    }
}

async function swapY2XDesireX(testSwap, trader, tokenX, tokenY, fee, desireX, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapY2XDesireX(tokenX.address, tokenY.address, fee, desireX, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        acquireX: stringMinus(traderAmountXAfter, traderAmountXBefore),
        costY: stringMinus(traderAmountYBefore, traderAmountYAfter),
    }
}

async function getObservation(pool, id) {
    const {timestamp, accPoint, init} = await pool.observations(id);
    return {
        timestamp,
        accPoint: new BigNumber(accPoint.toString()),
        init
    }
}

describe("orcale", function () {
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
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, miner4, trader, seller1, seller2, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
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

        await factory.newPool(txAddr, tyAddr, 3000, 3000);
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
    
    it("(1)", async function () {

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 6000, '1000000');
        const swap0 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1899);

        const blockNumStart = await ethers.provider.getBlockNumber();
        const blockStart = await ethers.provider.getBlock(blockNumStart);
        const timestampStart = blockStart.timestamp;

        let stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1899')
        expect(stateCurrent.observationCurrentIndex).to.equal('0')
        const ob0 = await getObservation(pool, 0);
        console.log('ob0 :', ob0.accPoint.toFixed(0) , ' @ ', ob0.timestamp);

        const swap1 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1800);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1800')
        expect(stateCurrent.observationCurrentIndex).to.equal('0')
        const ob1 = await getObservation(pool, 0);
        console.log('ob1 :', ob1.accPoint.toFixed(0) , ' @ ', ob1.timestamp);

        // expand to 3
        await pool.connect(trader).expandObservationQueue('3');
        stateCurrent = await getState(pool);
        expect(stateCurrent.observationNextQueueLen).to.equal('3')

        const swap2 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1700);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1700')
        expect(stateCurrent.observationCurrentIndex).to.equal('1')
        const ob2 = await getObservation(pool, 1);
        console.log('ob2 :', ob2.accPoint.toFixed(0) , ' @ ', ob2.timestamp);

        expect(ob2.accPoint.minus(ob1.accPoint).div(ob2.timestamp - ob1.timestamp).toString()).to.equal('1800');

        const swap3 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1600);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1600')
        expect(stateCurrent.observationCurrentIndex).to.equal('2')

        const swap4 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1500);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1500')
        expect(stateCurrent.observationCurrentIndex).to.equal('0')

        const swap5 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1400);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1400')
        expect(stateCurrent.observationCurrentIndex).to.equal('1')
        const ob5 = await getObservation(pool, 1);
        console.log('ob5 :', ob5.accPoint.toFixed(0) , ' @ ', ob5.timestamp);
        
        await ethers.provider.send('evm_setNextBlockTimestamp', [timestampStart + 2000]);

        // expand to 2, nothing changed
        await pool.connect(trader).expandObservationQueue('2');
        stateCurrent = await getState(pool);
        expect(stateCurrent.observationNextQueueLen).to.equal('3')
        const blockNum = await ethers.provider.getBlockNumber();
        const block = await ethers.provider.getBlock(blockNum);
        const timestamp = block.timestamp;
        console.log('timestamp + 2000: ', timestamp);

        // expand to 5
        await pool.connect(trader).expandObservationQueue('5');
        stateCurrent = await getState(pool);
        expect(stateCurrent.observationNextQueueLen).to.equal('5')

        await ethers.provider.send('evm_setNextBlockTimestamp', [timestampStart + 4000]);
        const swap6 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1300);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1300')
        expect(stateCurrent.observationCurrentIndex).to.equal('2')
        const ob6 = await getObservation(pool, 2);
        console.log('ob6 :', ob6.accPoint.toFixed(0) , ' @ ', ob6.timestamp);
        const blockNum6 = await ethers.provider.getBlockNumber();
        const block6 = await ethers.provider.getBlock(blockNum6);
        const timestamp6 = block6.timestamp;
        console.log('timestamp + 4000: ', timestamp6);

        await ethers.provider.send('evm_setNextBlockTimestamp', [timestampStart + 6000]);
        const swap7 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1200);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1200')
        expect(stateCurrent.observationCurrentIndex).to.equal('3')
        const ob7 = await getObservation(pool, 3);
        console.log('ob7 :', ob7.accPoint.toFixed(0) , ' @ ', ob7.timestamp);
        const blockNum7 = await ethers.provider.getBlockNumber();
        const block7 = await ethers.provider.getBlock(blockNum7);
        const timestamp7 = block7.timestamp;
        console.log('timestamp + 6000: ', timestamp7);


        await ethers.provider.send('evm_setNextBlockTimestamp', [timestampStart + 8000]);
        const swap8 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1500);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1500')
        expect(stateCurrent.observationCurrentIndex).to.equal('4')
        const ob8 = await getObservation(pool, 4);
        console.log('ob8 :', ob8.accPoint.toFixed(0) , ' @ ', ob8.timestamp);
        const blockNum8 = await ethers.provider.getBlockNumber();
        const block8 = await ethers.provider.getBlock(blockNum8);
        const timestamp8 = block8.timestamp;
        console.log('timestamp + 8000: ', timestamp8);

        let accPoints = await pool.observe([7000, 6800, 6500, 6000, 5000, 4000, 2000, 1000, 0]);
        expect(accPoints[5].toString()).to.equal(ob6.accPoint.toFixed(0))
        
        accPoints = await pool.observe([7000, 6000, 6500]);
        expect(new BigNumber(accPoints[0].toString()).plus(accPoints[1].toString()).div(2).toFixed(0)).to.equal(accPoints[2].toString());

        accPoints = await pool.observe([7000, 6800, 6000]);
        expect(new BigNumber(accPoints[0].toString()).times(0.8).plus(new BigNumber(accPoints[2].toString()).times(0.2)).toFixed(0)).to.equal(accPoints[1].toString());

        accPoints = await pool.observe([2000, 1000, 0]);
        expect(new BigNumber(accPoints[0].toString()).plus(accPoints[2].toString()).div(2).toFixed(0)).to.equal(accPoints[1].toString());


        await ethers.provider.send('evm_setNextBlockTimestamp', [timestampStart + 10000]);
        const swap9 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1800);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1800')
        expect(stateCurrent.observationCurrentIndex).to.equal('0')
        const ob9 = await getObservation(pool, 0);
        console.log('ob9 :', ob9.accPoint.toFixed(0) , ' @ ', ob9.timestamp);
        const blockNum9 = await ethers.provider.getBlockNumber();
        const block9 = await ethers.provider.getBlock(blockNum9);
        const timestamp9 = block9.timestamp;
        console.log('timestamp + 10000: ', timestamp9);

        await ethers.provider.send('evm_setNextBlockTimestamp', [timestampStart + 12000]);
        const swap10 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 3000, new BigNumber(3000 * 10**18).toFixed(0), 1700);
        stateCurrent = await getState(pool);
        expect(stateCurrent.currentPoint).to.equal('1700')
        expect(stateCurrent.observationCurrentIndex).to.equal('1')
        const ob10 = await getObservation(pool, 1);
        console.log('ob10 :', ob10.accPoint.toFixed(0) , ' @ ', ob10.timestamp);
        const blockNum10 = await ethers.provider.getBlockNumber();
        const block10 = await ethers.provider.getBlock(blockNum10);
        const timestamp10 = block10.timestamp;
        console.log('timestamp + 12000: ', timestamp10);

        accPoints = await pool.observe([0, 1000, 2000]);
        console.log(accPoints);
        expect(accPoints[0].toString()).to.equal(ob10.accPoint.toFixed(0))
        expect(accPoints[2].toString()).to.equal(ob9.accPoint.toFixed(0))
        expect(new BigNumber(accPoints[0].toString()).plus(accPoints[2].toString()).div(2).toFixed(0)).to.equal(accPoints[1].toString());
    });
});