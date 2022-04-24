const { expect } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { getLimOrder, getFeeCharge, getPoolParts} = require('./funcs.js');

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
    return [currentPoint, BigNumber(liquidity.toString()), BigNumber(liquidityX.toString())]
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
    // console.log(price);
    // console.log(liquidity);
    // console.log(price.sqrt());
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
function y2xAt(point, rate, amountY) {
    sp = rate.pow(point).sqrt();
    liquidity = floor(amountY.div(sp));
    acquireX = floor(liquidity.div(sp));
    liquidity = ceil(acquireX.times(sp));
    costY = ceil(liquidity.times(sp));
    return [acquireX, costY];
}
function y2xAtLiquidity(point, rate, desireX, liquidity, liquidityX) {
    const maxLiquidityX = x2l(desireX, point, rate, true);

    const transformLiquidityY = liquidityX.gt(maxLiquidityX) ? maxLiquidityX : liquidityX;
    const acquireX = l2x(transformLiquidityY, point, rate, false);
    const costY = l2y(transformLiquidityY, point, rate, true);
    return [acquireX, costY, liquidityX.minus(transformLiquidityY)];
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

async function checkLimOrder(eSellingX, eAccEarnX, eSellingY, eAccEarnY, eEarnX, eEarnY, poolAddr, pt) {
    const {sellingX, accEarnX, sellingY, accEarnY, earnX, earnY} = await getLimOrder(poolAddr, pt);
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
async function getStatusVal(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}
async function checkStatusVal(eVal, poolAddr, pt) {
    val = await getStatusVal(poolAddr, pt);
    expect(eVal).to.equal(val);
}

  function getFee(amount) {
      const originFee = ceil(amount.times(3).div(997));
      const charged = getFeeCharge(originFee);
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
async function burn(poolAddr, miner, pl, pr, liquidDelta) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    await pool.connect(miner).burn(pl, pr, liquidDelta);
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
  it("swap no limorder y2x desireX range complex", async function () {
    const [signer, miner1, miner2, miner3, seller0, seller1, trader, trader2, receiver] = await ethers.getSigners();

    const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule} = await getPoolParts();
    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule);
    await factory.deployed();
    await factory.enableFeeAmount(3000, 50);

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

    [currPt, liquidity, liquidityX] = await printState(poolAddr);

    await tokenY.transfer(trader.address, 10000000000);
    x_5001 = l2x(BigNumber(30000), 5001, rate, false);

    desireX_5001 = floor(x_5001.times(11).div(53));
    [acquireX, costY, liquidityXExpect_5001] = y2xAtLiquidity(5001, rate, desireX_5001, BigNumber("30000"), BigNumber("30000"));
    costY_WithFee = ceil(costY.times(1000).div(997));
    feeScaleY_5001_RemainTrader1 = getFeeScale(getFee(costY), BigNumber("30000"));
    
    // add lim order to sell y and sell x
    const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
    const testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
    await testAddLimOrder.deployed();
    await addLimOrderWithY(tokenX, tokenY, seller0, testAddLimOrder, 10000000, 5000);
    await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, 10000000, 5050);
    await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, 20000000, 5100);
    acquireX_5050_Lim = BigNumber("10000000");
    acquireX_5100_Lim = BigNumber("20000000");
    costY_5050_Lim = x2yAt(5050, rate, acquireX_5050_Lim);
    costY_5100_Lim = x2yAt(5100, rate, acquireX_5100_Lim);

    const testSwapFactory = await ethers.getContractFactory("TestSwap");
    const testSwap = await testSwapFactory.deploy(factory.address);
    await testSwap.deployed();
    await tokenY.connect(trader).approve(testSwap.address, costY_WithFee.times(2).toFixed(0));
    await testSwap.connect(trader).swapY2X(
        tokenX.address, tokenY.address, 3000, costY_WithFee.toFixed(0), 5002);
    [currPt, liquidity, liquidityX] = await printState(poolAddr);
    expect(liquidity.toFixed(0)).to.equal('30000');
    expect(liquidityX.toFixed(0)).to.equal(liquidityXExpect_5001.toFixed(0))

    console.log('liquidityX: ', liquidityX)

    // for trader 2
    // [currPt, liquidity, liquidityX] = await printState(poolAddr);
    // console.log('liquidityX: ', liquidityX)

    desireX_5001_Remain = l2x(liquidityX, 5001, rate, false);
    costY_5001_Remain = l2y(liquidityX, 5001, rate, true);
    desireX_5002_5050 = xInRange(BigNumber("30000"), 5002, 5050, rate, false);
    costY_5002_5050 = yInRange(BigNumber("30000"), 5002, 5050, rate, true);
    desireX_5050_5100 = xInRange(BigNumber("50000"), 5050, 5100, rate, false);
    costY_5050_5100 = yInRange(BigNumber("50000"), 5050, 5100, rate, true);
    desireX_5100_5125 = xInRange(BigNumber("20000"), 5100, 5125, rate, false);
    costY_5100_5125 = yInRange(BigNumber("20000"), 5100, 5125, rate, true);

    currX_5125_Origin = l2x(BigNumber("20000"), 5125, rate, false);
    desireX_5125_part = BigNumber(currX_5125_Origin.times(3).div(13).toFixed(0));
    [acquireX_5125_part, costY_5125_part, liquidityXExpect_5125] = y2xAtLiquidity(5125, rate, desireX_5125_part, BigNumber("20000"), BigNumber("20000"));

    desireXRange = desireX_5001_Remain.plus(
        desireX_5002_5050).plus(
        desireX_5050_5100).plus(
        desireX_5100_5125).plus(
        desireX_5125_part).plus(
        acquireX_5050_Lim).plus(
        acquireX_5100_Lim);

    acquireXRange = desireX_5001_Remain.plus(
        desireX_5002_5050).plus(
        desireX_5050_5100).plus(
        desireX_5100_5125).plus(
        acquireX_5125_part).plus(
        acquireX_5050_Lim).plus(
        acquireX_5100_Lim);
        
    costYRange = costY_5001_Remain.plus(
        costY_5002_5050).plus(
        costY_5050_5100).plus(
        costY_5100_5125).plus(
        costY_5125_part).plus(
        costY_5050_Lim).plus(
        costY_5100_Lim);

    costYRangeWithFee = amountAddFee(costY_5001_Remain).plus(
        amountAddFee(costY_5002_5050)).plus(
        amountAddFee(costY_5050_5100)).plus(
        amountAddFee(costY_5100_5125)).plus(
        amountAddFee(costY_5125_part)).plus(
        amountAddFee(costY_5050_Lim)).plus(
        amountAddFee(costY_5100_Lim));
    
    feeScaleY_5001_Remain_5002_5050 = getFeeScale(getFee(costY_5001_Remain.plus(costY_5002_5050)), BigNumber("30000"));
    feeScaleY_5050_5100 = getFeeScale(getFee(costY_5050_5100), BigNumber("50000"));
    feeScaleY_5100_5125_part = getFeeScale(getFee(costY_5100_5125.plus(costY_5125_part)), BigNumber("20000"));

    await tokenY.transfer(trader2.address, 10000000000);

    await tokenY.connect(trader2).approve(testSwap.address, costYRangeWithFee.times(2).toFixed(0));
    await testSwap.connect(trader2).swapY2XDesireX(
        tokenX.address, tokenY.address, 3000, desireXRange.toFixed(0), 5200);
    
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
    console.log("feeY of miner2: ", feeY2.toFixed(0));
    feeScaleYMiner2 = feeScaleY_5050_5100.plus(feeScaleY_5100_5125_part);
    expect(feeY2.toFixed(0)).to.equal(feeScale2Fee(feeScaleYMiner2, BigNumber("20000")).toFixed(0));

    // check miner 3
    await burn(poolAddr, miner3, 4900, 5100, 0);
    [liquid3, feeScaleX3, feeScaleY3, feeX3, feeY3] = await getLiquidity(testMint, tokenX, tokenY, miner3, 4900, 5100);
    console.log("feeY of miner3: ", feeY3.toFixed(0));
    feeScaleYMiner3 = feeScaleY_5001_RemainTrader1.plus(feeScaleY_5001_Remain_5002_5050).plus(feeScaleY_5050_5100);
    expect(feeY3.toFixed(0)).to.equal(feeScale2Fee(feeScaleYMiner3, BigNumber("30000")).toFixed(0));
  });
});