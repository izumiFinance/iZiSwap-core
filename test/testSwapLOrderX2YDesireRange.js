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
  return [currentPoint, BigNumber(liquidity._hex), BigNumber(liquidityX._hex)]
}

async function getStatusVal(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
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


function floor(a) {
    return BigNumber(a.toFixed(0, 3));
}
function ceil(b) {
    return BigNumber(b.toFixed(0, 2));
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
    liquidity = ceil(amountY.div(sp));
    costX = ceil(liquidity.div(sp));
    return costX;
}
function x2yAt(point, rate, amountX) {
    sp = rate.pow(point).sqrt();
    liquidity = floor(amountX.times(sp));
    acquireY = floor(liquidity.times(sp));
    liquidity = ceil(acquireY.div(sp));
    costX = ceil(liquidity.div(sp));
    return [acquireY, costX];
}


function x2yAtLiquidity(point, rate, desireY, liquidity, liquidityX) {
    const liquidityY = liquidity.minus(liquidityX);
    const maxLiquidityY = y2l(desireY, point, rate, true);

    const transformLiquidityX = liquidityY.gt(maxLiquidityY) ? maxLiquidityY : liquidityY;
    const acquireY = l2y(transformLiquidityX, point, rate, false);
    const costX = l2x(transformLiquidityX, point, rate, true);
    return [acquireY, costX, liquidityX.plus(transformLiquidityX)];
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
  it("swap with limorder x2y desireY range complex", async function () {
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

    await factory.newPool(txAddr, tyAddr, 3000, 5100);
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
    expect(liquidityX.toFixed(0)).to.equal('0');
    expect(liquidity.toFixed(0)).to.equal('20000');
    y_5100_Liquid = l2y(BigNumber("20000"), 5100, rate, true);
    desireY_5100 = BigNumber(y_5100_Liquid.times(5).div(16).toFixed(0));
    [acquireY_5100, costX_5100, liquidityXExpect] = x2yAtLiquidity(5100, rate, desireY_5100, liquidity, liquidityX);
    costX_5100_WithFee = amountAddFee(costX_5100);
    feeScaleX_5100_Trader1 = getFeeScale(getFee(costX_5100),BigNumber("20000"));

    const testSwapFactory = await ethers.getContractFactory("TestSwap");
    const testSwap = await testSwapFactory.deploy(factory.address);
    await testSwap.deployed();
    
    await tokenX.transfer(trader.address, 10000000000);
    await tokenX.connect(trader).approve(testSwap.address, costX_5100_WithFee.times(2).toFixed(0));

    await testSwap.connect(trader).swapX2YDesireY(
        tokenX.address, tokenY.address, 3000, desireY_5100.toFixed(0), 5100);
    expect(costX_5100_WithFee.plus(blockNum2BigNumber(await tokenX.balanceOf(trader.address))).toFixed(0)).to.equal("10000000000");

    expect(acquireY_5100.toFixed(0)).to.equal(blockNum2BigNumber(await tokenY.balanceOf(trader.address)).toFixed(0));

    [currPt, liquidity, liquidityX] = await printState(poolAddr);
    expect(liquidity.toFixed(0)).to.equal('20000')
    expect(liquidityX.toFixed(0)).to.equal(liquidityXExpect.toFixed(0));

    // now for trader2
    acquireY_5100_Remain = l2y(liquidity.minus(liquidityX), 5100, rate, false);
    costX_5100_Remain = l2x(liquidity.minus(liquidityX), 5100, rate, true);
    feeScaleX_5100_Remain = getFeeScale(getFee(costX_5100_Remain), BigNumber("20000"));

    acquireY_5050_5100 = yInRange(BigNumber("50000"), 5050, 5100, rate, false);
    costX_5050_5100 = xInRange(BigNumber("50000"), 5050, 5100, rate, true);
    feeScaleX_5050_5100 = getFeeScale(getFee(costX_5050_5100), BigNumber("50000"));

    acquireY_5000_5050 = yInRange(BigNumber("30000"), 5000, 5050, rate, false);
    costX_5000_5050 = xInRange(BigNumber("30000"), 5000, 5050, rate, true);
    feeScaleX_5000_5050 = getFeeScale(getFee(costX_5000_5050), BigNumber("30000"));

    // a lim order at 4950 split the liquid
    acquireY_4950_5000 = yInRange(BigNumber("40000"), 4950, 5000, rate, false);
    costX_4950_5000 = xInRange(BigNumber("40000"), 4950, 5000, rate, true);
    feeScaleX_4950_5000 = getFeeScale(getFee(costX_4950_5000), BigNumber("40000"));

    acquireY_4900_4950 = yInRange(BigNumber("40000"), 4900, 4950, rate, false);
    costX_4900_4950 = xInRange(BigNumber("40000"), 4900, 4950, rate, true);
    feeScaleX_4900_4950 = getFeeScale(getFee(costX_4900_4950), BigNumber("40000"));

    acquireY_4870_4900 = yInRange(BigNumber("10000"), 4870, 4900, rate, false);
    costX_4870_4900 = xInRange(BigNumber("10000"), 4870, 4900, rate, true);
    amountY_4869_Liquid = l2y(BigNumber("10000"), 4869, rate, false);
    desireY_4869_Remain = BigNumber(amountY_4869_Liquid.times(2).div(11).toFixed(0));
    [acquireY_4869_Remain, costX_4869_Remain, liquidityXExpect] = x2yAtLiquidity(4869, rate, desireY_4869_Remain, BigNumber("10000"), BigNumber('0'));
    feeScaleX_4870_4900_4869_Remain = getFeeScale(getFee(costX_4870_4900.plus(costX_4869_Remain)), BigNumber("10000"));

    // // console.log("aayaay: ", aay.toFixed(0));
    // // console.log("ccxccx: ", ccx.toFixed(0));

    // limorder, 2 order to sell x (expect unchanged), 3 order to sell y
    const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
    const testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
    await testAddLimOrder.deployed();
    await addLimOrderWithX(tokenX, tokenY, seller0, testAddLimOrder, 100000000, 5150);
    await addLimOrderWithX(tokenX, tokenY, seller0, testAddLimOrder, 200000000, 5100);
    await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, 300000000, 5050);
    await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, 400000000, 4950);
    await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, 500000000, 4850);

    acquireY_5050_Lim = BigNumber(300000000);
    costX_5050_Lim = y2xAt(5050, rate, acquireY_5050_Lim);
    acquireY_4950_Lim = BigNumber(400000000);
    costX_4950_Lim = y2xAt(4950, rate, acquireY_4950_Lim);

    acquireYRange = acquireY_5100_Remain.plus(
        acquireY_5050_5100).plus(
        acquireY_5000_5050).plus(
        acquireY_4950_5000).plus(
        acquireY_4900_4950).plus(
        acquireY_4870_4900).plus(
        acquireY_4869_Remain).plus("700000000");
    
    desireYRange = acquireY_5100_Remain.plus(
        acquireY_5050_5100).plus(
        acquireY_5000_5050).plus(
        acquireY_4950_5000).plus(
        acquireY_4900_4950).plus(
        acquireY_4870_4900).plus(
        desireY_4869_Remain).plus("700000000");
    costXRangeWithFee = amountAddFee(costX_5100_Remain).plus(
        amountAddFee(costX_5050_5100)).plus(
        amountAddFee(costX_5000_5050)).plus(
        amountAddFee(costX_4950_5000)).plus(
        amountAddFee(costX_4900_4950)).plus(
        amountAddFee(costX_4870_4900.plus(costX_4869_Remain))).plus(amountAddFee(costX_5050_Lim)).plus(amountAddFee(costX_4950_Lim));

    await tokenX.transfer(trader2.address, 10000000000);
    await tokenX.connect(trader2).approve(testSwap.address, costXRangeWithFee.times(2).toFixed(0));
    await testSwap.connect(trader2).swapX2YDesireY(
        tokenX.address, tokenY.address, 3000, desireYRange.toFixed(0), 4860);
    expect(costXRangeWithFee.plus(blockNum2BigNumber(await tokenX.balanceOf(trader2.address))).toFixed(0)).to.equal("10000000000");
    expect(acquireYRange.toFixed(0)).to.equal(blockNum2BigNumber(await tokenY.balanceOf(trader2.address)).toFixed(0));

    
    // check status at curr point after swap
    [currPt, liquidity, liquidityX] = await printState(poolAddr);
    expect(currPt).to.equal(4869);
    expect(liquidity.toFixed(0)).to.equal("10000");
    expect(liquidityX.toFixed(0)).to.equal(liquidityXExpect.toFixed(0));

    // check limit order
    await checkLimOrder(
        BigNumber('100000000'),
        BigNumber('0'),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber("0"),
        poolAddr,
        5150
    );
    await checkLimOrder(
        BigNumber('200000000'),
        BigNumber('0'),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber("0"),
        poolAddr,
        5100
    );
    await checkLimOrder(
        BigNumber('0'),
        BigNumber(costX_5050_Lim),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber(costX_5050_Lim),
        BigNumber("0"),
        poolAddr,
        5050
    );
    await checkLimOrder(
        BigNumber('0'),
        BigNumber(costX_4950_Lim),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber(costX_4950_Lim),
        BigNumber("0"),
        poolAddr,
        4950
    );
    await checkLimOrder(
        BigNumber('0'),
        BigNumber('0'),
        BigNumber("500000000"),
        BigNumber("0"),
        BigNumber("0"),
        BigNumber('0'),
        poolAddr,
        4850
    );
    // check status val after swap
    // 1: only endpt of liquidity
    // 2: only limorder (sellingX>0 || sellingY > 0)
    // 3: 1 & 2
    await checkStatusVal(3, poolAddr, 4850);
    await checkStatusVal(1, poolAddr, 4900);
    await checkStatusVal(0, poolAddr, 4950);
    await checkStatusVal(1, poolAddr, 5000);
    await checkStatusVal(1, poolAddr, 5050);
    await checkStatusVal(3, poolAddr, 5100);
    await checkStatusVal(3, poolAddr, 5150);

    // check miner2
    await burn(poolAddr, miner2, 5050, 5150, 0);
    [liquid2, feeScaleX2, feeScaleY2, feeX2, feeY2] = await getLiquidity(testMint, tokenX, tokenY, miner2, 5050, 5150);
    console.log("feeX of miner2: ", feeX2.toFixed(0));
    feeScaleXMiner2_q128 = feeScaleX_5100_Trader1.plus(feeScaleX_5100_Remain).plus(feeScaleX_5050_5100);

    let q128 = BigNumber(2).pow(128);
    mul = feeScaleXMiner2_q128.times(BigNumber("20000"));
    
    expectFeeX2 = floor(mul.minus(mul.mod(q128)).div(q128)).toFixed(0);
    console.log("expect feeY of miner2: ", expectFeeX2);
    expect(feeX2.toFixed(0)).to.equal(expectFeeX2);

    await burn(poolAddr, miner3, 4900, 5100, 0);
    [liquid3, feeScaleX3, feeScaleY3, feeX3, feeY3] = await getLiquidity(testMint, tokenX, tokenY, miner3, 4900, 5100);
    console.log("feeX of miner3: ", feeX3.toFixed(0));
    feeScaleXMiner3 = feeScaleX_5050_5100.plus(feeScaleX_5000_5050).plus(feeScaleX_4950_5000).plus(feeScaleX_4900_4950);

    console.log("expect feeY of miner3: ", feeScale2Fee(feeScaleXMiner3, BigNumber('30000')).toFixed(0));
    expect(feeX3.toFixed(0)).to.equal(feeScale2Fee(feeScaleXMiner3, BigNumber('30000')).toFixed(0));

    await burn(poolAddr, miner1, 4850, 5000, 0);
    [liquid1, feeScaleX1, feeScaleY1, feeX1, feeY1] = await getLiquidity(testMint, tokenX, tokenY, miner1, 4850, 5000);
    console.log("feeX of miner1: ", feeX1.toFixed(0));
    feeScaleXMiner1 = feeScaleX_4950_5000.plus(feeScaleX_4900_4950).plus(feeScaleX_4870_4900_4869_Remain);

    console.log("expect feeX of miner1: ", feeScale2Fee(feeScaleXMiner1, BigNumber('10000')).toFixed(0));
    expect(feeX1.toFixed(0)).to.equal(feeScale2Fee(feeScaleXMiner1, BigNumber('10000')).toFixed(0));  
  });
});