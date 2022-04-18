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
    const {sqrtPrice_96, currentPoint, liquidity, liquidityX, locked} = await pool.state();
    return [currentPoint, BigNumber(liquidity._hex), BigNumber(liquidityX._hex)]
}

async function getLimOrder(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    [sellingX, accEarnX, sellingY, accEarnY, earnX, earnY] = await pool.limitOrderData(pt);
    return [
        BigNumber(sellingX._hex),
        BigNumber(accEarnX._hex),
        BigNumber(sellingY._hex),
        BigNumber(accEarnY._hex),
        BigNumber(earnX._hex),
        BigNumber(earnY._hex)
    ]
}
async function getStatusVal(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}
async function burn(poolAddr, miner, pl, pr, liquidDelta) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    await pool.connect(miner).burn(pl, pr, liquidDelta);
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

function x2l(x, tick, rate, up) {
    const price = rate.pow(tick);
    const l = x.times(price.sqrt());
    if (up) {
        return ceil(l);
    } else {
        return floor(l);
    }
}

function y2l(y, tick, rate, up) {
    const price = rate.pow(tick);
    const l = y.div(price.sqrt());
    if (up) {
        return ceil(l);
    } else {
        return floor(l);
    }
}
function y2xAtLiquidity(point, rate, amountY, liquidity, liquidityX) {
    const maxLiquidityX = y2l(amountY, point, rate, false);

    const transformLiquidityY = liquidityX.gt(maxLiquidityX) ? maxLiquidityX : liquidityX;
    const acquireX = l2x(transformLiquidityY, point, rate, false);
    const costY = l2y(transformLiquidityY, point, rate, true);
    return [acquireX, costY, liquidityX.minus(transformLiquidityY)];
}
function y2xAt(point, rate, amountY) {
    sp = rate.pow(point).sqrt();
    liquidity = floor(amountY.div(sp));
    acquireX = floor(liquidity.div(sp));
    liquidity = ceil(acquireX.times(sp));
    costY = ceil(liquidity.times(sp));
    return [acquireX, costY];
}
function x2yAt(point, rate, amountX) {
    sp = rate.pow(point).sqrt();
    liquidity = ceil(amountX.times(sp));
    costY = ceil(liquidity.times(sp));
    return costY;
}

function yInRange(liquidity, pl, pr, rate, up) {
    amountY = BigNumber("0");
    price = rate.pow(pl);
    for (var i = pl; i < pr; i ++) {
        amountY = amountY.plus(liquidity.times(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountY);
    } else {
        return floor(amountY);
    }
}
function xInRange(liquidity, pl, pr, rate, up) {
    amountX = BigNumber("0");
    price = rate.pow(pl);
    for (var i = pl; i < pr; i ++) {
        amountX = amountX.plus(liquidity.div(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountX);
    } else {
        return floor(amountX);
    }
}
function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex);
}
function amountAddFee(amount) {
    return ceil(amount.times(1000).div(997));
}
function getFee(amount) {
    const originFee = ceil(amount.times(3).div(997));
    const charged = floor(originFee.times(20).div(100));
    return originFee.minus(charged);
}
function bigIntDiv(a, b) {
    if (a.mod(b).eq(0)) {
        return a.div(b);
    }
    const c = a.minus(a.mod(b));
    return c.div(b);
}

function getFeeScale(fee, liquidity) {
    const fee_128 = fee.times(BigNumber(2).pow(128));
    return  bigIntDiv(fee_128, liquidity);
}
function feeScale2Fee(feeScale, liquidity) {

    const fee_128 = feeScale.times(liquidity);
    return bigIntDiv(fee_128, BigNumber(2).pow(128));
}
async function checkLimOrder(eSellingX, eAccEarnX, eSellingY, eAccEarnY, eEarnX, eEarnY, poolAddr, pt) {
    [sellingX, accEarnX, sellingY, accEarnY, earnX, earnY] = await getLimOrder(poolAddr, pt);
    expect(sellingX.toFixed(0)).to.equal(eSellingX.toFixed(0));
    expect(accEarnX.toFixed(0)).to.equal(eAccEarnX.toFixed(0));
    expect(sellingY.toFixed(0)).to.equal(eSellingY.toFixed(0));
    expect(accEarnY.toFixed(0)).to.equal(eAccEarnY.toFixed(0));
    expect(earnX.toFixed(0)).to.equal(eEarnX.toFixed(0));
    expect(earnY.toFixed(0)).to.equal(eEarnY.toFixed(0));
}
async function checkStatusVal(eVal, poolAddr, pt) {
    val = await getStatusVal(poolAddr, pt);
    expect(eVal).to.equal(val);
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

describe("swap", function () {
  it("swap with limorder y2x range complex", async function () {
    const [signer, miner1, miner2, miner3, seller0, seller1, trader, trader2, receiver] = await ethers.getSigners();
    const {swapX2YModule, swapY2XModule, mintModule, limitOrderModule} = await getPoolParts();
    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, mintModule, limitOrderModule);
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

    await factory.newPool(txAddr, tyAddr, 3000, 5001);
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

    [currPt, liquidity, liquidityX] = await printState(poolAddr);

    await tokenY.transfer(trader.address, 10000000000);
    x_5002 = l2x(BigNumber(30000), 5002, rate, false);
    expect(liquidity.toFixed(0)).to.equal('30000');
    expect(liquidity.toFixed(0)).to.equal('30000');


    amountY_5002 = BigNumber(12000);
    [acquireX, costY, liquidityXExpect_5002] = y2xAtLiquidity(5002, rate, amountY_5002, x_5002, liquidity, liquidityX);
    costY_WithFee = ceil(costY.times(1000).div(997));
    feeScaleY_5002_RemainTrader1 = getFeeScale(getFee(costY), BigNumber(30000));

    // add lim order to sell y and sell x
    const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
    const testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
    await testAddLimOrder.deployed();
    await tokenY.transfer(seller0.address, 10000000000);
    await tokenY.connect(seller0).approve(testAddLimOrder.address, 10000000);
    await testAddLimOrder.connect(seller0).addLimOrderWithY(
        tokenX.address, tokenY.address, 3000, 5000, 10000000
    );
    await tokenX.transfer(seller1.address, 10000000000);
    await tokenX.connect(seller1).approve(testAddLimOrder.address, 30000000);
    await testAddLimOrder.connect(seller1).addLimOrderWithX(
        tokenX.address, tokenY.address, 3000, 5050, 10000000
    );
    await testAddLimOrder.connect(seller1).addLimOrderWithX(
        tokenX.address, tokenY.address, 3000, 5100, 20000000
    );
    acquireX_5050_Lim = BigNumber("10000000");
    acquireX_5100_Lim = BigNumber("20000000");
    costY_5050_Lim = x2yAt(5050, rate, acquireX_5050_Lim);
    costY_5100_Lim = x2yAt(5100, rate, acquireX_5100_Lim);
    
    const testSwapFactory = await ethers.getContractFactory("TestSwap");
    const testSwap = await testSwapFactory.deploy(factory.address);
    await testSwap.deployed();
    await tokenY.connect(trader).approve(testSwap.address, costY_WithFee.times(2).toFixed(0));
    await testSwap.connect(trader).swapY2X(
        tokenX.address, tokenY.address, 3000, costY_WithFee.toFixed(0), 5003);
    // for trader 2
    [currPt, liquidity_5002, liquidityX_5002] = await printState(poolAddr);
    expect(liquidity_5002.toFixed(0)).to.equal('30000');
    expect(liquidityX_5002.toFixed(0)).to.equal(liquidityXExpect_5002.toFixed(0));

    costY_5002_Remain = l2y(liquidityX_5002, 5002, rate, true);
    acquireX_5002_Remain = l2x(liquidityX_5002, 5002, rate, false);
    costY_5003_5050 = yInRange(BigNumber("30000"), 5003, 5050, rate, true);
    feeScaleY_5002_Remain_5003_5050 = getFeeScale(getFee(costY_5003_5050.plus(costY_5002_Remain)), BigNumber("30000"));
    console.log("liquidity: 30000,   cost:  ", costY_5003_5050.plus(costY_5002_Remain).toFixed(0), "   fee: ", getFee(costY_5003_5050.plus(costY_5002_Remain)).toFixed(0));
    costY_5050_5100 = yInRange(BigNumber("50000"), 5050, 5100, rate, true);
    feeScaleY_5050_5100 = getFeeScale(getFee(costY_5050_5100), BigNumber("50000"));
    console.log("liquidity: 50000,   cost:  ", costY_5050_5100.toFixed(0), "   fee: ", getFee(costY_5050_5100).toFixed(0));
    costY_5100_5125 = yInRange(BigNumber("20000"), 5100, 5125, rate, true);

    currX_5125_Origin = l2x(BigNumber("20000"), 5125, rate, false);

    currX_5125_part = BigNumber(currX_5125_Origin.times(3).div(13).toFixed(0));
    costY_5125_part = x2yAt(5125, rate, currX_5125_part);
    [acquireX_5125_part, costY_5125_part, liquidityXExpect_5125] = y2xAtLiquidity(5125, rate, costY_5125_part, BigNumber("20000"), BigNumber("20000"));
    feeScaleY_5100_5125_with_part = getFeeScale(getFee(costY_5100_5125.plus(costY_5125_part)), BigNumber("20000"));
    console.log("liquidity: 20000,   cost:  ", costY_5100_5125.plus(costY_5125_part).toFixed(0), "   fee: ", getFee(costY_5100_5125.plus(costY_5125_part)).toFixed(0));

    costYRange = costY_5002_Remain.plus(
        costY_5003_5050).plus(
        costY_5050_5100).plus(
        costY_5100_5125).plus(
        costY_5125_part).plus(
        costY_5050_Lim).plus(
        costY_5100_Lim);
    costYRangeWithFee = amountAddFee(costY_5002_Remain).plus(
        amountAddFee(costY_5003_5050)).plus(
        amountAddFee(costY_5050_5100)).plus(
        amountAddFee(costY_5100_5125)).plus(
        amountAddFee(costY_5125_part)).plus(
        amountAddFee(costY_5050_Lim)).plus(
        amountAddFee(costY_5100_Lim));

    acquireX_5003_5050 = xInRange(BigNumber("30000"), 5003, 5050, rate, false);
    acquireX_5050_5100 = xInRange(BigNumber("50000"), 5050, 5100, rate, false);
    acquireX_5100_5125 = xInRange(BigNumber("20000"), 5100, 5125, rate, false);
    acquireX_5125_Remain = currX_5125_part.plus("0");
    acquireXRange = acquireX_5002_Remain.plus(
        acquireX_5003_5050).plus(
        acquireX_5050_5100).plus(
        acquireX_5100_5125).plus(
        acquireX_5125_Remain).plus(
        acquireX_5050_Lim).plus(
        acquireX_5100_Lim);

    await tokenY.transfer(trader2.address, 10000000000);

    await tokenY.connect(trader2).approve(testSwap.address, costYRangeWithFee.times(2).toFixed(0));
    await testSwap.connect(trader2).swapY2X(
        tokenX.address, tokenY.address, 3000, costYRangeWithFee.toFixed(0), 5200);
    
    // expect acquireX should equal
    expect(acquireXRange.toFixed(0)).to.equal(blockNum2BigNumber(await tokenX.balanceOf(trader2.address)).toFixed(0));
    // expect costY should equal
    expect(
        costYRangeWithFee.plus(blockNum2BigNumber(await tokenY.balanceOf(trader2.address))).toFixed(0),
        "10000000000");

    [currPt, liquidity, liquidityX_5125] = await printState(poolAddr);
    expect(currPt).to.equal(5125);
    expect(liquidity.toFixed(0)).to.equal("20000");
    expect(liquidityX_5125.toFixed(0)).to.equal(liquidityXExpect_5125.toFixed(0));

    // check limit order
    await checkLimOrder(
        BigNumber('0'),
        BigNumber('0'),
        BigNumber("10000000"),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber("0"),
        poolAddr,
        5000
    );
    await checkLimOrder(
        BigNumber('0'),
        BigNumber('0'),
        BigNumber("0"),
        costY_5050_Lim,
        BigNumber("0"),
        costY_5050_Lim,
        poolAddr,
        5050
    );
    await checkLimOrder(
        BigNumber('0'),
        BigNumber('0'),
        BigNumber("0"),
        costY_5100_Lim,
        BigNumber("0"),
        costY_5100_Lim,
        poolAddr,
        5100
    );
    // check status val
    await checkStatusVal(1, poolAddr, 4850);
    await checkStatusVal(1, poolAddr, 4900);
    await checkStatusVal(0, poolAddr, 4950);
    await checkStatusVal(3, poolAddr, 5000);
    await checkStatusVal(1, poolAddr, 5050);
    await checkStatusVal(1, poolAddr, 5100);
    await checkStatusVal(1, poolAddr, 5150);

    // check miner 2
    await burn(poolAddr, miner2, 5050, 5150, 0);
    [liquid2, feeScaleX2, feeScaleY2, feeX2, feeY2] = await getLiquidity(testMint, tokenX, tokenY, miner2, 5050, 5150);

    console.log("feeY of miner 2: ", feeY2.toFixed(0));
    feeScaleYMiner2 = feeScaleY_5050_5100.plus(feeScaleY_5100_5125_with_part);
    expect(feeY2.toFixed(0)).to.equal(feeScale2Fee(feeScaleYMiner2, BigNumber("20000")).toFixed(0));

    await burn(poolAddr, miner3, 4900, 5100, 0);
    [liquid3, feeScaleX3, feeScaleY3, feeX3, feeY3] = await getLiquidity(testMint, tokenX, tokenY, miner3, 4900, 5100);
    console.log("feeY of miner3: ", feeY3.toFixed(0));
    feeScaleYMiner3 = feeScaleY_5002_RemainTrader1.plus(feeScaleY_5002_Remain_5003_5050).plus(feeScaleY_5050_5100);
    expect(feeY3.toFixed(0)).to.equal(feeScale2Fee(feeScaleYMiner3, BigNumber("30000")).toFixed(0));
  });
});