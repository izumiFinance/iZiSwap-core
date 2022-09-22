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


describe("pre compute pool address", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var poolAddr;
    var pool;
    var testPreComputePoolAddress;
    var factory;
    var txAddr, tyAddr;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, miner4, trader, seller1, seller2, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule, 50);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, 3000);
        poolAddr = (await factory.pool(txAddr, tyAddr, 3000)).toLowerCase();

        const TestPreComputePoolAddress = await ethers.getContractFactory('TestPreComputePoolAddress');
        testPreComputePoolAddress = await TestPreComputePoolAddress.deploy();

    });
    
    it("compute", async function () {
        const computedAddress = (await testPreComputePoolAddress.preComputePoolAddress(
            factory.address,
            txAddr,
            tyAddr,
            3000
        )).toLowerCase()

        console.log(poolAddr)
        console.log(computedAddress)

        expect(poolAddr).to.equal(computedAddress)
    });
});