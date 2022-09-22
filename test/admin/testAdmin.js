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


describe("admin operation", function () {
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
    var factory;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, miner4, trader, seller1, seller2, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule, 50);
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
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2000, 4000, new BigNumber(10**18).times(10**8).toFixed(0));

        /// check fees and feeScaled
        const state = await pool.state();
        const feeXBefore1 =  await pool.totalFeeXCharged();
        const feeYBefore1 =  await pool.totalFeeYCharged();
        const YAmount1 = new BigNumber(10**18).times(1000).toFixed(0);
        await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, 1, YAmount1);
        const feeXAfter1 =  await pool.totalFeeXCharged();
        const feeYAfter1 =  await pool.totalFeeYCharged();
        // X is too small, will have no x fees
        expect(new BigNumber(feeYAfter1.toString()).minus(feeYBefore1.toString()).div(0.0015).toFixed(0)).to.equal(YAmount1);
        expect(new BigNumber(feeXAfter1.toString()).minus(feeXBefore1.toString()).div(0.0015).toFixed(0)).to.equal('0');


        // not fee charger, will fail
        try {
            await pool.connect(miner1).collectFeeCharged()
        } catch (e) {
            console.log(e.message)
            expect(String(e.message).search("NR") !== -1).to.equal(true);
        }

        const balanceXBefore1 = await tokenX.balanceOf(receiver.address);
        const balanceYBefore1 = await tokenY.balanceOf(receiver.address);
        await pool.connect(receiver).collectFeeCharged()
        const balanceXAfter1 = await tokenX.balanceOf(receiver.address);
        const balanceYAfter1 = await tokenY.balanceOf(receiver.address);
        expect(new BigNumber(balanceYAfter1.toString()).minus(balanceYBefore1.toString()).toString()).to.equal(feeYAfter1.toString());
        expect(new BigNumber(balanceXAfter1.toString()).minus(balanceXBefore1.toString()).toString()).to.equal(feeXAfter1.toString());

        const feeXBefore2 =  await pool.totalFeeXCharged();
        const feeYBefore2 =  await pool.totalFeeYCharged();
        expect(feeXBefore1.toString()).to.equal('0');
        expect(feeXBefore2.toString()).to.equal('0');
        const YAmount2 = new BigNumber(10**18).times(1000).toFixed(0);
        const XAmount2 = new BigNumber(10**18).times(1000).toFixed(0);
        await testFlash.connect(miner2).flash(tokenX.address, tokenY.address, 3000, XAmount2, YAmount2);
        const feeXAfter2 =  await pool.totalFeeXCharged();
        const feeYAfter2 =  await pool.totalFeeYCharged();

         // try to change receiver, will fail
         try {
            await factory.connect(miner1).modifyChargeReceiver(miner1.address);
        } catch (e) {
            console.log(e.message);
            expect(String(e.message).search("Ownable: caller is not the owner") !== -1).to.equal(true);
        }

        await factory.connect(signer).modifyChargeReceiver(miner1.address);
        const balanceXBefore2 = await tokenX.balanceOf(miner1.address);
        const balanceYBefore2 = await tokenY.balanceOf(miner1.address);
        await pool.connect(miner1).collectFeeCharged()
        const balanceXAfter2 = await tokenX.balanceOf(miner1.address);
        const balanceYAfter2 = await tokenY.balanceOf(miner1.address);
        expect(new BigNumber(balanceYAfter2.toString()).minus(balanceYBefore2.toString()).toString()).to.equal(feeYAfter2.toString());
        expect(new BigNumber(balanceXAfter2.toString()).minus(balanceXBefore2.toString()).toString()).to.equal(feeXAfter2.toString());

    });
});