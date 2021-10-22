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
  const IzumiswapPool = await ethers.getContractFactory("IzumiswapPool");
  pool = await IzumiswapPool.attach(poolAddr);
  [sqrtPrice_96, currPt, currX, currY, liquidity, allX, locked] = await pool.state();
  return [currPt, BigNumber(currX._hex), BigNumber(currY._hex), BigNumber(liquidity._hex), allX, locked]
}

function l2y(liquidity, tick, rate, up) {
    price = rate.pow(tick);
    y = liquidity.times(price.sqrt());
    if (up) {
        return BigNumber(y.toFixed(0, 2));
    } else {
        return BigNumber(y.toFixed(0, 3));
    }
}

function l2x(liquidity, tick, rate, up) {
    price = rate.pow(tick);
    x = liquidity.div(price.sqrt());
    if (up) {
        return BigNumber(x.toFixed(0, 2));
    } else {
        return BigNumber(x.toFixed(0, 3));
    }
}

function floor(a) {
    return BigNumber(a.toFixed(0, 3));
}
function ceil(b) {
    return BigNumber(b.toFixed(0, 2));
}
function y2xAt(tick, rate, amountY) {
    sp = rate.pow(tick).sqrt();
    liquidity = floor(amountY.div(sp));
    acquireX = floor(liquidity.div(sp));
    liquidity = ceil(acquireX.times(sp));
    costY = ceil(liquidity.times(sp));
    return [acquireX, costY];
}
function y2xAtLiquidity(point, rate, desireX, currX, currY, liquidity) {
    sp = rate.pow(point).sqrt();
    currYLim = ceil(liquidity.times(sp));
    deltaY = BigNumber('0');
    if (currYLim.gte(currY)) {
      deltaY = currYLim.minus(currY);
    }
    if (desireX.gte(currX)) {
      return [currX, deltaY];
    }
    acquireX = desireX.plus('0');
    costY = ceil(acquireX.times(deltaY).div(currX));
    return [acquireX, costY];
}
function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex);
}
async function getPoolParts() {
  const IzumiswapPoolPartFactory = await ethers.getContractFactory("IzumiswapPoolPart");
  const izumiswapPoolPart = await IzumiswapPoolPartFactory.deploy();
  await izumiswapPoolPart.deployed();
  const IzumiswapPoolPartDesireFactory = await ethers.getContractFactory("IzumiswapPoolPartDesire");
  const izumiswapPoolPartDesire = await IzumiswapPoolPartDesireFactory.deploy();
  await izumiswapPoolPartDesire.deployed();
  return [izumiswapPoolPart.address, izumiswapPoolPartDesire.address];
}
describe("swap y2x desireX", function () {
  it("swap y2x desireX at single price", async function () {
    const [signer, miner1, miner2, miner3, trader] = await ethers.getSigners();

    [poolPart, poolPartDesire] = await getPoolParts();
    // deploy a factory
    const IzumiswapFactory = await ethers.getContractFactory("IzumiswapFactory");

    const factory = await IzumiswapFactory.deploy(poolPart, poolPartDesire);
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

    await factory.newPool(txAddr, tyAddr, 3000, 5000);
    poolAddr = await factory.pool(txAddr, tyAddr, 3000);

    // test mint
    const testMintFactory = await ethers.getContractFactory("TestMint");
    const testMint = await testMintFactory.deploy(factory.address);
    await testMint.deployed();
    getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);

    expect(getPoolAddr).to.equal(poolAddr);

    

    await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 4850, 5000, 10000);
    await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, 5050, 5150, 20000);
    await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 4900, 5100, 30000);

    let rate = BigNumber('1.0001');

    [currPt, currX, currY, liquidity, allX, locked] = await printState(poolAddr);

    await tokenY.transfer(trader.address, 10000000000);
    x_5001 = l2x(BigNumber(30000), 5001, rate, false);

    acquireX_5001 = floor(x_5001.times(11).div(53));
    [acquireX, costY] = y2xAtLiquidity(5001, rate, acquireX_5001, x_5001, BigNumber('0'), BigNumber("30000"));
    
    costY_WithFee = ceil(costY.times(1003).div(1000));
    
    const testSwapFactory = await ethers.getContractFactory("TestSwap");
    const testSwap = await testSwapFactory.deploy(factory.address);
    await testSwap.deployed();
    await tokenY.connect(trader).approve(testSwap.address, costY_WithFee.times(2).toFixed(0));

    await testSwap.connect(trader).swapY2XDesireX(
        tokenX.address, tokenY.address, 3000, acquireX.toFixed(0), 5002);
    expect(costY_WithFee.plus(blockNum2BigNumber(await tokenY.balanceOf(trader.address))).toFixed(0)).to.equal("10000000000");
    expect(acquireX.toFixed(0)).to.equal(blockNum2BigNumber(await tokenX.balanceOf(trader.address)).toFixed(0));

    [currPt, currX, currY, liquidity, allX, locked] = await printState(poolAddr);
    expect(currPt).to.equal(5001);
    expect(currX.toFixed(0)).to.equal(l2x(BigNumber(30000), 5001, rate, false).minus(acquireX).toFixed(0));
    expect(currY.toFixed(0)).to.equal(costY.toFixed(0));
    expect(liquidity.toFixed(0)).to.equal("30000");
    expect(allX).to.equal(false);
  });
});