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

async function burn(poolAddr, miner, pl, pr, liquidDelta) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    await pool.connect(miner).burn(pl, pr, liquidDelta);
}
async function collect(poolAddr, miner, recipient, pl, pr, xLim, yLim) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    await pool.connect(miner).collect(recipient.address, pl, pr, xLim, yLim);
}
async function getLiquidity(testMint, tokenX, tokenY, miner, pl, pr) {
    [liquidity, lastFeeScaleX_128, lastFeeScaleY_128, tokenOwedX, tokenOwedY] = await testMint.connect(miner).liquidities(
        tokenX.address, tokenY.address, 3000, pl, pr
    );
    return [
        BigNumber(liquidity._hex),
        BigNumber(lastFeeScaleX_128._hex),
        BigNumber(lastFeeScaleY_128._hex),
        BigNumber(tokenOwedX._hex),
        BigNumber(tokenOwedY._hex)
    ]
}
describe("quoter", function () {
    var signer, miner1, trader1, trader2;
    var poolPart, poolPartDesire;
    var factory;
    var tokenX, tokenY;
    var txAddr, tyAddr;
    var poolAddr;
    var testMint;
    var testQuoter;
    var getPoolAddr;
    var testSwap;
    var rate;
    beforeEach(async function() {
        [signer, miner, trader1, trader2, recipient1, recipient2, receiver] = await ethers.getSigners();
        [poolPart, poolPartDesire, mintModule] = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");
    
        factory = await iZiSwapFactory.deploy(receiver.address, poolPart, poolPartDesire, mintModule);
        await factory.deployed();
    
        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();
    
        await tokenX.transfer(miner.address, 10000000000);
        await tokenY.transfer(miner.address, 20000000000);

        await factory.newPool(txAddr, tyAddr, 3000, -5000);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);
    
        // test mint
        const testMintFactory = await ethers.getContractFactory("TestMint");
        testMint = await testMintFactory.deploy(factory.address);
        await testMint.deployed();
        getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);
        expect(getPoolAddr).to.equal(poolAddr);
    
        await addLiquidity(testMint, miner, tokenX, tokenY, 3000, 1000, 5000, 10000);
    
        const testSwapFactory = await ethers.getContractFactory("TestSwap");
        testSwap = await testSwapFactory.deploy(factory.address);
        await testSwap.deployed();

        const testQuoterFactory = await ethers.getContractFactory("TestQuoter");
        testQuoter = await testQuoterFactory.deploy(factory.address);

        rate = BigNumber('1.0001');    

    });
  it("quoter", async function () {
      // y2x
      var acquireX_1000_5000 = getAmountX(1000, 5000, rate, BigNumber("10000"), false);
      var requireY_1000_5000 = getAmountY(1000, 5000, rate, BigNumber("10000"), true);

      var costYWithFee = amountAddFee(requireY_1000_5000);
      var costYFee = getFee(requireY_1000_5000);
      var acquireX = acquireX_1000_5000;
      
      await testQuoter.connect(trader1).swapY2X(
          tokenX.address, tokenY.address, 3000, "1000000000000", 7000);

      console.log("acquireX: ", acquireX.toFixed(0));
      console.log("quoter: ", (await testQuoter.amount()).toString());
  });
});