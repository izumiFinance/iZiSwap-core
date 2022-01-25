const { expect } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');

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

async function addLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr, liquidity) {
  amountX = await tokenX.balanceOf(miner.address);
  amountY = await tokenY.balanceOf(miner.address);
  await tokenX.connect(miner).approve(testMint.address, amountX);
  await tokenY.connect(miner).approve(testMint.address, amountY);
  await testMint.connect(miner).mint(tokenX.address, tokenY.address, fee, pl, pr, liquidity);
}

async function printState(poolAddr) {
  const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
  pool = await iZiSwapPool.attach(poolAddr);
  [sqrtPrice_96, currPt, currX, currY, liquidity, allX, locked] = await pool.state();
  return [currPt, BigNumber(currX._hex), BigNumber(currY._hex), BigNumber(liquidity._hex), allX, locked]
}

function floor(a) {
    return BigNumber(a.toFixed(0, 3));
}
function ceil(b) {
    return BigNumber(b.toFixed(0, 2));
}

function getAmountX(l, r, rate, liquidity, up) {
    amountX = BigNumber('0');
    price = rate.pow(l);
    for (var idx = l; idx < r; idx ++) {
        amountX = amountX.plus(liquidity.div(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountX);
    }
    return floor(amountX);
}

function getAmountY(l, r, rate, liquidity, up) {
    var amountY = BigNumber('0');
    var price = rate.pow(l);
    for (var idx = l; idx < r; idx ++) {
        amountY = amountY.plus(liquidity.times(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountY);
    }
    return floor(amountY);
}

function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex);
}
function amountAddFee(amount) {
    return ceil(amount.times(1003).div(1000));
}
function getFee(amount) {
    return ceil(amount.times(3).div(1000));
}


async function getPoolParts() {
    const iZiSwapPoolPartFactory = await ethers.getContractFactory("SwapX2YModule");
    const iZiSwapPoolPart = await iZiSwapPoolPartFactory.deploy();
    await iZiSwapPoolPart.deployed();
    const iZiSwapPoolPartDesireFactory = await ethers.getContractFactory("SwapY2XModule");
    const iZiSwapPoolPartDesire = await iZiSwapPoolPartDesireFactory.deploy();
    await iZiSwapPoolPartDesire.deployed();
    const MintModuleFactory = await ethers.getContractFactory('MintModule');
    const mintModule = await MintModuleFactory.deploy();
    await mintModule.deployed();
    return [iZiSwapPoolPart.address, iZiSwapPoolPartDesire.address, mintModule.address];
  }

async function checkBalance(token, miner, expectAmount) {
    var amount = await token.balanceOf(miner.address);
    expect(amount.toString()).to.equal(expectAmount.toFixed(0));
}

describe("swap with liquidity and negative pt", function () {
    var signer, miner1, miner2, trader1, trader2;
    var poolPart, poolPartDesire;
    var factory;
    var tokenX, tokenY;
    var txAddr, tyAddr;
    var poolAddr;
    var testMint;
    var getPoolAddr;
    var testSwap;
    var rate;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, trader1, trader2, receiver] = await ethers.getSigners();
        [poolPart, poolPartDesire, mintModule] = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");
    
        factory = await iZiSwapFactory.deploy(receiver.address, poolPart, poolPartDesire, mintModule);
        await factory.deployed();
    
        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();
    
        await tokenX.transfer(miner1.address, 10000000000);
        await tokenY.transfer(miner1.address, 20000000000);
        await tokenX.transfer(miner2.address, 30000000000);
        await tokenY.transfer(miner2.address, 40000000000);
        await tokenX.transfer(miner3.address, 50000000000);
        await tokenY.transfer(miner3.address, 60000000000);
    
        await factory.newPool(txAddr, tyAddr, 3000, -4001);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);
    
        // test mint
        const testMintFactory = await ethers.getContractFactory("TestMint");
        testMint = await testMintFactory.deploy(factory.address);
        await testMint.deployed();
        getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);
        expect(getPoolAddr).to.equal(poolAddr);
    
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -5000, -3000, 10000);
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, 3000, 5000, 20000);
        await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, -1000, 1000, 30000);
    
        const testSwapFactory = await ethers.getContractFactory("TestSwap");
        testSwap = await testSwapFactory.deploy(factory.address);
        await testSwap.deployed();

        rate = BigNumber('1.0001');    

    });
  it("swap contains zero liquidity y2x and x2y", async function () {
      // y2x
      var acquireX_M4000_M3000 = getAmountX(-4000, -3000, rate, BigNumber("10000"), false);
      var requireY_M4000_M3000 = getAmountY(-4000, -3000, rate, BigNumber("10000"), true);
      var acquireX_M1000_M50 = getAmountX(-1000, -50, rate, BigNumber("30000"), false);
      var requireY_M1000_M50 = getAmountY(-1000, -50, rate, BigNumber("30000"), true);
      var acquireX_M50_1000 = getAmountX(-50, 1000, rate, BigNumber("30000"), false);
      var requireY_M50_1000 = getAmountY(-50, 1000, rate, BigNumber("30000"), true);
      var acquireX_3000_5000 = getAmountX(3000, 5000, rate, BigNumber("20000"), false);
      var requireY_3000_5000 = getAmountY(3000, 5000, rate, BigNumber("20000"), true);

      var costYWithFee = amountAddFee(requireY_M4000_M3000).plus(
              amountAddFee(requireY_M1000_M50)).plus(
              amountAddFee(requireY_M50_1000)).plus(
              amountAddFee(requireY_3000_5000));
      var acquireX = acquireX_M4000_M3000.plus(acquireX_M1000_M50).plus(acquireX_M50_1000).plus(acquireX_3000_5000);
      
      await tokenY.transfer(trader1.address, "1000000000000");
      await tokenY.connect(trader1).approve(testSwap.address, "1000000000000");
      await testSwap.connect(trader1).swapY2X(
          tokenX.address, tokenY.address, 3000, "1000000000000", 7000);
      await checkBalance(tokenX, trader1, acquireX);
      await checkBalance(tokenY, trader1, BigNumber("1000000000000").minus(costYWithFee));

      // x2y

      var acquireY_M5000_M3000 = getAmountY(-5000, -3000, rate, BigNumber("10000"), false);
      var requireX_M5000_M3000 = getAmountX(-5000, -3000, rate, BigNumber("10000"), true);
      var acquireY_M1000_0 = getAmountY(-1000, 0, rate, BigNumber("30000"), false);
      var requireX_M1000_0 = getAmountX(-1000, 0, rate, BigNumber("30000"), true);
      var acquireY_0_1000 = getAmountY(0, 1000, rate, BigNumber("30000"), false);
      var requireX_0_1000 = getAmountX(0, 1000, rate, BigNumber("30000"), true);
      var acquireY_3000_5000 = getAmountY(3000, 5000, rate, BigNumber("20000"), false);
      var requireX_3000_5000 = getAmountX(3000, 5000, rate, BigNumber("20000"), true);

      var costXWithFee = amountAddFee(requireX_M5000_M3000).plus(
        amountAddFee(requireX_M1000_0)).plus(
        amountAddFee(requireX_0_1000)).plus(
        amountAddFee(requireX_3000_5000));
      var acquireY = acquireY_M5000_M3000.plus(acquireY_M1000_0).plus(acquireY_0_1000).plus(acquireY_3000_5000);
      
      await tokenX.transfer(trader2.address, "10000000000000");
      await tokenX.connect(trader2).approve(testSwap.address, "10000000000000");
      await testSwap.connect(trader2).swapX2Y(
          tokenX.address, tokenY.address, 3000, "10000000000000", -7000);
      await checkBalance(tokenY, trader2, acquireY);
      await checkBalance(tokenX, trader2, BigNumber("10000000000000").minus(costXWithFee));
  });
  it("swap contains zero liquidity y2xDesire and x2yDesire", async function () {
      // y2x
      var acquireX_M4000_M3000 = getAmountX(-4000, -3000, rate, BigNumber("10000"), false);
      var requireY_M4000_M3000 = getAmountY(-4000, -3000, rate, BigNumber("10000"), true);
      var acquireX_M1000_M50 = getAmountX(-1000, -50, rate, BigNumber("30000"), false);
      var requireY_M1000_M50 = getAmountY(-1000, -50, rate, BigNumber("30000"), true);
      var acquireX_M50_1000 = getAmountX(-50, 1000, rate, BigNumber("30000"), false);
      var requireY_M50_1000 = getAmountY(-50, 1000, rate, BigNumber("30000"), true);
      var acquireX_3000_5000 = getAmountX(3000, 5000, rate, BigNumber("20000"), false);
      var requireY_3000_5000 = getAmountY(3000, 5000, rate, BigNumber("20000"), true);

      var costYWithFee = amountAddFee(requireY_M4000_M3000).plus(
              amountAddFee(requireY_M1000_M50)).plus(
              amountAddFee(requireY_M50_1000)).plus(
              amountAddFee(requireY_3000_5000));
      var acquireX = acquireX_M4000_M3000.plus(acquireX_M1000_M50).plus(acquireX_M50_1000).plus(acquireX_3000_5000);
      
      await tokenY.transfer(trader1.address, "1000000000000");
      await tokenY.connect(trader1).approve(testSwap.address, "1000000000000");
      await testSwap.connect(trader1).swapY2XDesireX(
          tokenX.address, tokenY.address, 3000, "1000000000000", 7000);
      await checkBalance(tokenX, trader1, acquireX);
      await checkBalance(tokenY, trader1, BigNumber("1000000000000").minus(costYWithFee));

      // x2y

      var acquireY_M5000_M3000 = getAmountY(-5000, -3000, rate, BigNumber("10000"), false);
      var requireX_M5000_M3000 = getAmountX(-5000, -3000, rate, BigNumber("10000"), true);
      var acquireY_M1000_0 = getAmountY(-1000, 0, rate, BigNumber("30000"), false);
      var requireX_M1000_0 = getAmountX(-1000, 0, rate, BigNumber("30000"), true);
      var acquireY_0_1000 = getAmountY(0, 1000, rate, BigNumber("30000"), false);
      var requireX_0_1000 = getAmountX(0, 1000, rate, BigNumber("30000"), true);
      var acquireY_3000_5000 = getAmountY(3000, 5000, rate, BigNumber("20000"), false);
      var requireX_3000_5000 = getAmountX(3000, 5000, rate, BigNumber("20000"), true);

      var costXWithFee = amountAddFee(requireX_M5000_M3000).plus(
        amountAddFee(requireX_M1000_0)).plus(
        amountAddFee(requireX_0_1000)).plus(
        amountAddFee(requireX_3000_5000));
      var acquireY = acquireY_M5000_M3000.plus(acquireY_M1000_0).plus(acquireY_0_1000).plus(acquireY_3000_5000);
      
      await tokenX.transfer(trader2.address, "10000000000000");
      await tokenX.connect(trader2).approve(testSwap.address, "10000000000000");
      await testSwap.connect(trader2).swapX2YDesireY(
          tokenX.address, tokenY.address, 3000, "10000000000000", -7000);
      await checkBalance(tokenY, trader2, acquireY);
      await checkBalance(tokenX, trader2, BigNumber("10000000000000").minus(costXWithFee));
  });
});