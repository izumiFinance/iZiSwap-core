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

    console.log("tokenX: " + tokenX.address.toLowerCase());
    console.log("tokenY: " + tokenY.address.toLowerCase());

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
    console.log("txAddr: " + txAddr);
    console.log("tyAddr: " + tyAddr);

    console.log("tx: " + tokenX.address);
    console.log("ty: " + tokenY.address);
    return [tokenX, tokenY];
}

async function airdrop(tokenX, tokenY, miner1, miner2, miner3) {
  await tokenX.transfer(miner1.address, 10000000000);
  expect(await tokenX.balanceOf(miner1.address)).to.equal(10000000000);
  await tokenY.transfer(miner1.address, 20000000000);
  expect(await tokenY.balanceOf(miner1.address)).to.equal(20000000000);
  await tokenX.transfer(miner2.address, 30000000000);
  await tokenY.transfer(miner2.address, 40000000000);
  await tokenX.transfer(miner3.address, 50000000000);
  await tokenY.transfer(miner3.address, 60000000000);
}

async function addLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr, liquidity) {
  console.log("enter add liquidity");
  amountX = await tokenX.balanceOf(miner.address);
  amountY = await tokenY.balanceOf(miner.address);
  await tokenX.connect(miner).approve(testMint.address, amountX);
  console.log("approve x: " + await tokenX.allowance(miner.address, testMint.address));
  await tokenY.connect(miner).approve(testMint.address, amountY);
  console.log("approve y: " + await tokenY.allowance(miner.address, testMint.address));
  await testMint.connect(miner).mint(tokenX.address, tokenY.address, fee, pl, pr, liquidity);
}

function getAmountX(l, r, rate, liquidity) {
  amountX = BigNumber('0');
  price = rate.pow(l);
  for (var idx = l; idx < r; idx ++) {
    amountX = amountX.plus(liquidity.div(price.sqrt()));
    price = price.times(rate);
  }
  return amountX;
}

function getAmountY(l, r, rate, liquidity) {
  amountY = BigNumber('0');
  price = rate.pow(l);
  for (var idx = l; idx < r; idx ++) {
    amountY = amountY.plus(liquidity.times(price.sqrt()));
    price = price.times(rate);
  }
  return amountY;
}

function depositYAtPrice(p, rate, liquidity) {
  price = rate.pow(p);
  amountY = liquidity.times(price.sqrt());
  return BigNumber(amountY.toFixed(0, 2));
}

function depositXY(l, r, p, rate, liquidity) {
  expect(l).to.lessThanOrEqual(p);
  expect(r).to.greaterThan(p);
  amountY = getAmountY(l, p, rate, liquidity);
  amountX = getAmountX(p + 1, r, rate, liquidity);
  amountY = BigNumber(amountY.toFixed(0, 2)).plus(depositYAtPrice(p, rate, liquidity));
  amountX = BigNumber(amountX.toFixed(0, 2));
  return [amountX, amountY];
}

async function printState(poolAddr) {
  const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
  pool = await iZiSwapPool.attach(poolAddr);
  [sqrtPrice_96, currPt, currX, currY, liquidity, allX, locked] = await pool.state();
  console.log(sqrtPrice_96);
  console.log(currPt);
  console.log(currX);
  console.log(currY);
  console.log(liquidity);
  console.log(allX);
  console.log(locked);
}

function ceil(b) {
  return BigNumber(b.toFixed(0, 2));
}

async function getPoolParts() {
  const SwapX2YModuleFactory = await ethers.getContractFactory("SwapX2YModule");
  const swapX2YModule = await SwapX2YModuleFactory.deploy();
  await swapX2YModule.deployed();
  
  const SwapY2XModuleFactory = await ethers.getContractFactory("SwapY2XModule");
  const swapY2XModule = await SwapY2XModuleFactory.deploy();
  await swapY2XModule.deployed();

  const MintModuleFactory = await ethers.getContractFactory('MintModule');
  const mintModule = await MintModuleFactory.deploy();
  await mintModule.deployed();

  const LimitOrderModuleFactory = await ethers.getContractFactory('LimitOrderModule');
  const limitOrderModule = await LimitOrderModuleFactory.deploy();
  await limitOrderModule.deployed();
  return {
    swapX2YModule: swapX2YModule.address,
    swapY2XModule: swapY2XModule.address,
    mintModule: mintModule.address,
    limitOrderModule: limitOrderModule.address,
  };
}
describe("Mint", function () {
  it("check miner deposit", async function () {
    const [signer, miner1, miner2, miner3, receiver] = await ethers.getSigners();

    console.log("balance: " + signer.getBalance());

    const {swapX2YModule, swapY2XModule, mintModule, limitOrderModule} = await getPoolParts();

    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, mintModule, limitOrderModule);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

    [tokenX, tokenY] = await getToken();
    txAddr = tokenX.address.toLowerCase();
    tyAddr = tokenY.address.toLowerCase();

    await tokenX.transfer(miner1.address, 10000000000);
    await tokenY.transfer(miner1.address, 20000000000);
    await tokenX.transfer(miner2.address, 30000000000);
    await tokenY.transfer(miner2.address, 40000000000);
    await tokenX.transfer(miner3.address, 50000000000);
    await tokenY.transfer(miner3.address, 60000000000);

    await factory.newPool(txAddr, tyAddr, 3000, 5010);
    poolAddr = await factory.pool(txAddr, tyAddr, 3000);

    // test mint
    const testMintFactory = await ethers.getContractFactory("TestMint");
    const testMint = await testMintFactory.deploy(factory.address);
    await testMint.deployed();
    getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);
    console.log("poolAddr: " + poolAddr);
    console.log("getPoolAddr: " + getPoolAddr);
    expect(getPoolAddr).to.equal(poolAddr);

    

    await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 4850, 5000, 10000);
    await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, 5050, 5150, 20000);
    await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 4900, 5100, 30000);

    let rate = BigNumber('1.0001');

    await printState(poolAddr);

    // check miner1
    miner1DepositAmountY = ceil(getAmountY(4850, 5000, rate, BigNumber('10000')));
    miner1AmountY = await tokenY.balanceOf(miner1.address);
    miner1AmountY = BigNumber(miner1AmountY._hex);
    miner1OriginAmountY = miner1DepositAmountY.plus(miner1AmountY);
    expect(miner1OriginAmountY.toFixed(0)).to.equal("20000000000");

    // check miner2
    miner2DepositAmountX = ceil(getAmountX(5050, 5150, rate, BigNumber('20000')));
    miner2AmountX = await tokenX.balanceOf(miner2.address);
    miner2AmountX = BigNumber(miner2AmountX._hex);
    miner2OriginAmountX = miner2DepositAmountX.plus(miner2AmountX);
    expect(miner2OriginAmountX.toFixed(0)).to.equal("30000000000");

    // check miner3
    [miner3DepositAmountX, miner3DepositAmountY] = depositXY(4900, 5100, 5010, rate, BigNumber('30000'));
    miner3AmountX = await tokenX.balanceOf(miner3.address);
    miner3AmountX = BigNumber(miner3AmountX._hex);
    miner3AmountY = await tokenY.balanceOf(miner3.address);
    miner3AmountY = BigNumber(miner3AmountY._hex);
    miner3OriginAmountX = miner3DepositAmountX.plus(miner3AmountX);
    miner3OriginAmountY = miner3DepositAmountY.plus(miner3AmountY);
    expect(miner3OriginAmountX.toFixed(0)).to.equal("50000000000");
    expect(miner3OriginAmountY.toFixed(0)).to.equal("60000000000");
  });
});