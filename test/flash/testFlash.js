const { expect } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

const {getPoolParts, addLiquidity } = require('../funcs');
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


describe("flash", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var poolAddr;
    var pool;
    var testMint;
    var testSwap;
    var testFlash;
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


        // test mint
        const testMintFactory = await ethers.getContractFactory("TestMint");
        testMint = await testMintFactory.deploy(factory.address);
        await testMint.deployed();

        // test flash
        const testFlashFactory = await ethers.getContractFactory("TestFlash");
        testFlash = await testFlashFactory.deploy(factory.address);
        await testFlash.deployed();

        const getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);
        expect(getPoolAddr.toLowerCase()).to.equal(poolAddr.toLowerCase());

        const poolFactory = await ethers.getContractFactory('iZiSwapPool');
        pool = await poolFactory.attach(poolAddr);

        await tokenX.mint(miner1.address, '1000000000000000000000000000000');
        await tokenY.mint(miner1.address, '1000000000000000000000000000000');
        await tokenX.mint(miner2.address, '1000000000000000000000000000000');
        await tokenY.mint(miner2.address, '1000000000000000000000000000000');
        await tokenX.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner2).approve(testFlash.address, '1000000000000000000000000000000');
        await tokenY.connect(miner2).approve(testFlash.address, '1000000000000000000000000000000');
        q128 = BigNumber(2).pow(128).toFixed(0);

    });
    
    it("(1)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2000, 4000, '1000000');

        await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, 1, 1);

        // borrow too token Y, expect fail
        try {
            await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, 1, new BigNumber(10**18).times(10000000).toFixed(0));
        } catch (e) {
            console.log(e.message);
            expect(!String(e.message).search("not borrow enough tokenY")).to.equal(false);
        }

        // borrow too token X, expect fail
        try {
            await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, new BigNumber(10**18).times(10000000).toFixed(0), 1);
        } catch (e) {
            console.log(e.message)
            expect(!String(e.message).search("not borrow enough tokenX")).to.equal(false);
        }

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2000, 4000, new BigNumber(10**18).times(10**8).toFixed(0));

        await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, 1, 2);


        /// check fees and feeScaled
        const state = await pool.state();
        const feeXBefore1 =  await pool.totalFeeXCharged();
        const feeYBefore1 =  await pool.totalFeeYCharged();
        const feeScaleX128Before1 = await pool.feeScaleX_128();
        const feeScaleY128Before1 = await pool.feeScaleY_128();
        const YAmount1 = new BigNumber(10**18).times(1000).toFixed(0);
        await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, 1, YAmount1);
        const feeXAfter1 =  await pool.totalFeeXCharged();
        const feeYAfter1 =  await pool.totalFeeYCharged();
        const feeScaleX128After1 = await pool.feeScaleX_128();
        const feeScaleY128After1 = await pool.feeScaleY_128();
        // X is too small, will have no x fees
        expect(new BigNumber(feeYAfter1.toString()).minus(feeYBefore1.toString()).div(0.0015).toFixed(0)).to.equal(YAmount1);
        expect(new BigNumber(feeXAfter1.toString()).minus(feeXBefore1.toString()).div(0.0015).toFixed(0)).to.equal('0');
        const deltaFeeScaledY1281 = new BigNumber(feeScaleY128After1.toString()).minus(feeScaleY128Before1.toString());
        const deltaExpectedY1 = new BigNumber(YAmount1).times(0.0015).times(q128).div(state.liquidity.toString());
        expect(deltaExpectedY1.toFixed(0)).to.equal(deltaFeeScaledY1281.toFixed(0));
        const deltaFeeScaledX1281 = new BigNumber(feeScaleX128After1.toString()).minus(feeScaleX128Before1.toString());
        const deltaExpectedX1 = new BigNumber(1).times(q128).div(state.liquidity.toString());
        expect(deltaExpectedX1.toFixed(0)).to.equal(deltaFeeScaledX1281.toFixed(0));

        const feeXBefore2 =  await pool.totalFeeXCharged();
        const feeYBefore2 =  await pool.totalFeeYCharged();
        const feeScaleX128Before2 = await pool.feeScaleX_128();
        const feeScaleY128Before2 = await pool.feeScaleY_128();
        const XAmount2 = new BigNumber(10**18).times(1000).toFixed(0);
        await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, XAmount2, 1);
        const feeXAfter2 =  await pool.totalFeeXCharged();
        const feeYAfter2 =  await pool.totalFeeYCharged();
        const feeScaleX128After2 = await pool.feeScaleX_128();
        const feeScaleY128After2 = await pool.feeScaleY_128();
        // Y is too small, will have no y fees
        expect(new BigNumber(feeYAfter2.toString()).minus(feeYBefore2.toString()).div(0.0015).toFixed(0)).to.equal('0');
        expect(new BigNumber(feeXAfter2.toString()).minus(feeXBefore2.toString()).div(0.0015).toFixed(0)).to.equal(XAmount2);
        const deltaFeeScaledY1282 = new BigNumber(feeScaleY128After2.toString()).minus(feeScaleY128Before2.toString());
        const deltaExpectedY2 = new BigNumber(1).times(q128).div(state.liquidity.toString());
        expect(deltaExpectedY2.toFixed(0)).to.equal(deltaFeeScaledY1282.toFixed(0));
        const deltaFeeScaledX1282 = new BigNumber(feeScaleX128After2.toString()).minus(feeScaleX128Before2.toString());
        const deltaExpectedX2 = new BigNumber(XAmount2).times(0.0015).times(q128).div(state.liquidity.toString());
        expect(deltaExpectedX2.toFixed(0)).to.equal(deltaFeeScaledX1282.toFixed(0));


        // do not pay back enough X
        try {
            await testFlash.connect(miner2).flashNotPayBackEnoughX(tokenX.address, tokenY.address, 3000, 1, 2);
        } catch (e) {
            console.log(e.message)
            expect(String(e.message).search("FX") !== -1).to.equal(true);
        }

        // do not pay back enough Y
        try {
            await testFlash.connect(miner2).flashNotPayBackEnoughY(tokenX.address, tokenY.address, 3000, 1, 2);
        } catch (e) {
            console.log(e.message)
            expect(String(e.message).search("FY") !== -1).to.equal(true);
        }

         // do not pay back enough X
         try {
            await testFlash.connect(miner2).flashNotPayBackEnoughX(tokenX.address, tokenY.address, 3000, new BigNumber(10**18).times(1000).toFixed(0), 2);
        } catch (e) {
            console.log(e.message)
            expect(String(e.message).search("FX") !== -1).to.equal(true);
        }

        // do not pay back enough Y
        try {
            await testFlash.connect(miner2).flashNotPayBackEnoughY(tokenX.address, tokenY.address, 3000, 1, new BigNumber(10**18).times(1000).toFixed(0));
        } catch (e) {
            console.log(e.message)
            expect(String(e.message).search("FY") !== -1).to.equal(true);
        }

    });
});