const { expect } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { assert } = require("console");
const { getLimOrder, getAcquiredFee, getPoolParts, checkLimOrder } = require('./funcs.js');

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
  return {currPt: currentPoint, liquidity: BigNumber(liquidity._hex).toFixed(0), liquidityX: BigNumber(liquidityX._hex).toFixed(0), locked}
}

async function getStatusVal(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}

function floor(a) {
    return a.toFixed(0, 3);
}
function ceil(b) {
    return b.toFixed(0, 2);
}
function l2y(liquidity, tick, rate, up) {
    const price = BigNumber(rate).pow(tick);
    const y = BigNumber(liquidity).times(price.sqrt());
    if (up) {
        return ceil(y);
    } else {
        return floor(y);
    }
}

function y2l(y, tick, rate, up) {
    const price = BigNumber(rate).pow(tick);
    const l = BigNumber(y).div(price.sqrt());
    if (up) {
        return ceil(l);
    } else {
        return floor(l);
    }
}

function l2x(liquidity, tick, rate, up) {
    price = BigNumber(rate).pow(tick);
    x = BigNumber(liquidity).div(price.sqrt());
    if (up) {
        return BigNumber(x.toFixed(0, 2));
    } else {
        return BigNumber(x.toFixed(0, 3));
    }
}

function x2l(x, tick, rate, up) {
    const price = BigNumber(rate).pow(tick);
    const l = BigNumber(x).times(price.sqrt());
    if (up) {
        return ceil(l);
    } else {
        return floor(l);
    }
}
function x2YDesireY(point, rate, amountY) {
    const sp = BigNumber(rate).pow(point).sqrt();
    const liquidity = ceil(BigNumber(amountY).div(sp));
    const costX = ceil(BigNumber(liquidity).div(sp));
    return costX;
}
// function x2yAt(point, rate, amountX) {
//     sp = rate.pow(point).sqrt();
//     liquidity = floor(amountX.times(sp));
//     acquireY = floor(liquidity.times(sp));
//     liquidity = ceil(acquireY.div(sp));
//     costX = ceil(liquidity.div(sp));
//     return [acquireY, costX];
// }
function y2XAt(point, rate, amountY) {
    const sp = BigNumber(rate).pow(point).sqrt();
    let l = floor(BigNumber(amountY).div(sp));
    const acquireX = floor(BigNumber(l).div(sp));
    l = ceil(BigNumber(acquireX).times(sp));
    const costY = ceil(BigNumber(l).times(sp));
    return [acquireX, costY];
}

function stringMinus(a, b) {
    return BigNumber(a).minus(b).toFixed(0);
}

function stringMul(a, b) {
    const mul = BigNumber(a).times(b).toFixed(0);
    return mul;
}

function stringDiv(a, b) {
    let an = BigNumber(a);
    an = an.minus(an.mod(b));
    return an.div(b).toFixed(0);
}

function stringAdd(a, b) {
    return BigNumber(a).plus(b).toFixed(0);
}

function stringLess(a, b) {
    return BigNumber(a).lt(b);
}

function stringMin(a, b) {
    if (stringLess(a, b)) {
        return a;
    } else {
        return b;
    }
}

function x2yAtLiquidity(point, rate, desireY, liquidity, liquidityX) {
    const liquidityY = stringMinus(liquidity, liquidityX);
    const maxLiquidityY = y2l(desireY, point, rate, true);

    const transformLiquidityX = stringMin(liquidityY, maxLiquidityY);
    const acquireY = l2y(transformLiquidityX, point, rate, false);
    const costX = l2x(transformLiquidityX, point, rate, true);
    return {acquireY, costX, liquidityX: stringAdd(liquidityX, transformLiquidityX)};
}
function yInRange(liquidity, pl, pr, rate, up) {
    amountY = BigNumber("0");
    price = BigNumber(rate).pow(pl);
    const l = BigNumber(liquidity);
    for (var i = pl; i < pr; i ++) {
        amountY = amountY.plus(l.times(price.sqrt()));
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
    price = BigNumber(rate).pow(pl);
    const l = BigNumber(liquidity);
    for (var i = pl; i < pr; i ++) {
        amountX = amountX.plus(l.div(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountX);
    } else {
        return floor(amountX);
    }
}
function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex).toFixed(0);
}

function stringMul(a, b) {
    const mul = BigNumber(a).times(b).toFixed(0);
    return mul;
}

function stringDiv(a, b) {
    let an = BigNumber(a);
    an = an.minus(an.mod(b));
    return an.div(b).toFixed(0);
}

function stringMod(a, b) {
    const an = BigNumber(a);
    const md = an.mod(b);
    return md.toFixed(0);
}
function stringAdd(a, b) {
    return BigNumber(a).plus(b).toFixed(0);
}
function amountAddFee(amount) {
    let feeAmount = stringDiv(stringMul(amount, '3'), '997');
    if (stringMod(stringMul(amount, '3'), '997') !== '0') {
        feeAmount = stringAdd(feeAmount, '1');
    }
    return BigNumber(amount).plus(feeAmount).toFixed(0);
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

function getFeeScale(feeAmount, liquidity) {
    const q128 = BigNumber(2).pow(128);
    const a = BigNumber(feeAmount).times(q128).toFixed(0);
    return stringDiv(a, liquidity);
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
        BigNumber(liquidity._hex).toFixed(0),
        BigNumber(lastFeeScaleX_128._hex).toFixed(0),
        BigNumber(lastFeeScaleY_128._hex).toFixed(0),
        BigNumber(tokenOwedX._hex).toFixed(0),
        BigNumber(tokenOwedY._hex).toFixed(0)
    ]
}
function getWithDraw(pc, pl, pr, pcLiquidity, pcLiquidityX, liquidityDelta, rate) {
    assert(pl <= pc, 'pl <= pc');
    assert(pc < pr, 'pc < pr');

    let amountY = yInRange(liquidityDelta, pl, pc, rate, false);
    let amountX = xInRange(liquidityDelta, pc+1, pr, rate, false);

    const pcLiquidityY = stringMinus(pcLiquidity, pcLiquidityX);
    const withdrawedLiquidityY = stringMin(pcLiquidityY, liquidityDelta);
    const withdrawedLiquidityX = stringMinus(liquidityDelta, withdrawedLiquidityY);

    const xc = l2x(withdrawedLiquidityX, pc, rate, false);
    const yc = l2y(withdrawedLiquidityY, pc, rate, false);

    amountX = stringAdd(amountX, xc);
    amountY = stringAdd(amountY, yc);

    return [amountX, amountY, stringMinus(pcLiquidityX, withdrawedLiquidityX)];
}

function getSum(amountList) {
    let res = '0';
    for (let a of amountList) {
        res = stringAdd(res, a);
    }
    return res;
}

function scale2Fee(scale_128, liquidity) {
    const q128 = BigNumber(2).pow(128).toFixed(0);
    return stringDiv(stringMul(scale_128, liquidity), q128);
}

describe("swap", function () {
  it("swap with limorder x2y desireY range complex", async function () {
    const [signer, miner1, miner2, miner3, seller0, seller1, trader, trader2, trader3, receiver] = await ethers.getSigners();

    const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule, 50);
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

    let rate = '1.0001';

    const {liquidityX: actualLiquidityX_5100_1} = await printState(poolAddr);
    expect(actualLiquidityX_5100_1).to.equal('0');
    const y_5100_Liquid = l2y("20000", 5100, rate, true);
    const desireY_5100 = BigNumber(y_5100_Liquid).times(5).div(16).toFixed(0);

    const {acquireY: acquireY_5100, costX: costX_5100, liquidityX: liquidityX_5100} = x2yAtLiquidity(5100, rate, desireY_5100, "20000", "0");

    console.log('desire y 5100: ', desireY_5100);
    console.log('acquireY_5100: ', acquireY_5100);

    const costX_5100_WithFee = amountAddFee(costX_5100);
    const feeScaleX_5100_Trader1 = getFeeScale(getAcquiredFee(costX_5100), '20000');

    const testSwapFactory = await ethers.getContractFactory("TestSwap");
    const testSwap = await testSwapFactory.deploy(factory.address);
    await testSwap.deployed();
    
    await tokenX.transfer(trader.address, 10000000000);
    await tokenX.connect(trader).approve(testSwap.address, stringMul(costX_5100_WithFee, '2'));

    await testSwap.connect(trader).swapX2YDesireY(
        tokenX.address, tokenY.address, 3000, desireY_5100, 5100);

    expect(stringAdd(costX_5100_WithFee, (await tokenX.balanceOf(trader.address)).toString())).to.equal("10000000000");

    expect(acquireY_5100).to.equal((await tokenY.balanceOf(trader.address)).toString());

    const {liquidityX: actualLiquidityX_5100_2} = await printState(poolAddr);
    expect(actualLiquidityX_5100_2).to.equal(liquidityX_5100);

    // now for trader2
    const acquireY_5100_Remain = l2y(stringMinus('20000', actualLiquidityX_5100_2), 5100, rate, false);
    const costX_5100_Remain = l2x(stringMinus('20000', actualLiquidityX_5100_2), 5100, rate, true);
    const feeScaleX_5100_Remain = getFeeScale(getAcquiredFee(costX_5100_Remain), "20000");

    const acquireY_5050_5100 = yInRange("50000", 5050, 5100, rate, false);
    const costX_5050_5100 = xInRange("50000", 5050, 5100, rate, true);
    const feeScaleX_5050_5100 = getFeeScale(getAcquiredFee(costX_5050_5100), "50000");

    const acquireY_5000_5050 = yInRange("30000", 5000, 5050, rate, false);
    const costX_5000_5050 = xInRange("30000", 5000, 5050, rate, true);
    const feeScaleX_5000_5050 = getFeeScale(getAcquiredFee(costX_5000_5050), "30000");

    // a lim order at 4950 split the liquid
    const acquireY_4950_5000 = yInRange("40000", 4950, 5000, rate, false);
    const costX_4950_5000 = xInRange("40000", 4950, 5000, rate, true);
    const feeScaleX_4950_5000 = getFeeScale(getAcquiredFee(costX_4950_5000), "40000");

    const acquireY_4900_4950 = yInRange("40000", 4900, 4950, rate, false);
    const costX_4900_4950 = xInRange("40000", 4900, 4950, rate, true);
    const feeScaleX_4900_4950 = getFeeScale(getAcquiredFee(costX_4900_4950), "40000");

    const acquireY_4870_4900 = yInRange("10000", 4870, 4900, rate, false);
    const costX_4870_4900 = xInRange("10000", 4870, 4900, rate, true);
    const amountY_4869_Liquid = l2y("10000", 4869, rate, false);
    const acquireY_4869_Desired = BigNumber(amountY_4869_Liquid).times(2).div(11).toFixed(0);
    const {acquireY: acquireY_4869_Remain, costX: costX_4869_Remain, liquidityX: liquidityX_4869} = x2yAtLiquidity(4869, rate, acquireY_4869_Desired, '20000', '0');
    const feeScaleX_4870_4900_4869_Remain = getFeeScale(getAcquiredFee(stringAdd(costX_4870_4900, costX_4869_Remain)), "10000");

    // console.log("aayaay: ", aay.toFixed(0));
    // console.log("ccxccx: ", ccx.toFixed(0));

    // limorder, 2 order to sell x (expect unchanged), 3 order to sell y
    const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
    const testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
    await testAddLimOrder.deployed();

    await addLimOrderWithX(tokenX, tokenY, seller0, testAddLimOrder, 100000000, 5150);
    await addLimOrderWithX(tokenX, tokenY, seller0, testAddLimOrder, 200000000, 5100);
    await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, 300000000, 5050);
    await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, 400000000, 4950);
    await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, 500000000, 4850);

    const acquireY_5050_Lim = '300000000';
    const costX_5050_Lim = x2YDesireY(5050, rate, acquireY_5050_Lim);
    const acquireY_4950_Lim = '400000000';
    const costX_4950_Lim = x2YDesireY(4950, rate, acquireY_4950_Lim);
    
    const desireYRange = getSum([
        acquireY_5100_Remain,
        acquireY_5050_5100,
        acquireY_5000_5050,
        acquireY_4950_5000,
        acquireY_4900_4950,
        acquireY_4870_4900,
        acquireY_4869_Desired,
        '700000000'
    ])

    const acquireYRange = getSum([
        acquireY_5100_Remain,
        acquireY_5050_5100,
        acquireY_5000_5050,
        acquireY_4950_5000,
        acquireY_4900_4950,
        acquireY_4870_4900,
        acquireY_4869_Remain,
        '700000000'
    ])
    const costXRangeWithFee = getSum([
        amountAddFee(costX_5100_Remain),
        amountAddFee(costX_5050_5100),
        amountAddFee(costX_5000_5050),
        amountAddFee(costX_4950_5000),
        amountAddFee(costX_4900_4950),
        amountAddFee(stringAdd(costX_4870_4900, costX_4869_Remain)),
        amountAddFee(costX_5050_Lim),
        amountAddFee(costX_4950_Lim)
    ])

    await tokenX.transfer(trader2.address, 10000000000);
    await tokenX.connect(trader2).approve(testSwap.address, stringMul(costXRangeWithFee, '2'));

    await testSwap.connect(trader2).swapX2YDesireY(
        tokenX.address, tokenY.address, 3000, desireYRange, 4860);
    
    expect(stringAdd(costXRangeWithFee, (await tokenX.balanceOf(trader2.address)).toString())).to.equal("10000000000");
    expect(acquireYRange).to.equal((await tokenY.balanceOf(trader2.address)).toString());
    
    // check status at curr point after swap
    let {currPt, liquidity, liquidityX: actualLiquidityX_4869} = await printState(poolAddr);
    expect(currPt).to.equal(4869);
    expect(liquidity).to.equal("10000");
    expect(actualLiquidityX_4869).to.equal(liquidityX_4869);

    // check limit order
    await checkLimOrder(
        '100000000',
        '0',
        '0',

        "0",
        "0",
        '0',

        "0",
        "0",

        "0",
        "0",

        poolAddr,
        5150
    );
    await checkLimOrder(
        '200000000',
        '0',
        '0',

        "0",
        "0",
        '0',

        "0",
        "0",
        
        "0",
        "0",
        poolAddr,
        5100
    );
    await checkLimOrder(
        '0',
        costX_5050_Lim,
        costX_5050_Lim,

        "0",
        "0",
        "0",

        "0",
        "0",

        costX_5050_Lim,
        "0",

        poolAddr,
        5050
    );
    await checkLimOrder(
        '0',
        costX_4950_Lim,
        costX_4950_Lim,

        "0",
        "0",
        "0",

        "0",
        "0",

        costX_4950_Lim,
        "0",

        poolAddr,
        4950
    );
    
    await checkLimOrder(
        '0',
        '0',
        '0',

        "500000000",
        "0",
        '0',

        "0",
        '0',

        "0",
        '0',
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
    const [liquid2, feeScaleX2, feeScaleY2, feeX2, feeY2] = await getLiquidity(testMint, tokenX, tokenY, miner2, 5050, 5150);
    console.log("feeX of miner2: ", feeX2);

    const q128 = BigNumber(2).pow(128).toFixed(0);

    const feeScaleXMiner2_q128 = getSum([feeScaleX_5100_Trader1, feeScaleX_5100_Remain, feeScaleX_5050_5100])
    
    const expectFeeX2 = stringDiv(stringMul(feeScaleXMiner2_q128, '20000'), q128);
    console.log("expect feeY of miner2: ", expectFeeX2);
    expect(feeX2).to.equal(expectFeeX2);

    await burn(poolAddr, miner3, 4900, 5100, 30000);
    const [liquid3, feeScaleX3, feeScaleY3, feeX3, feeY3] = await getLiquidity(testMint, tokenX, tokenY, miner3, 4900, 5100);
    console.log("feeX of miner3: ", feeX3);
    const feeScaleXMiner3_q128 = getSum([feeScaleX_5050_5100, feeScaleX_5000_5050, feeScaleX_4950_5000, feeScaleX_4900_4950]);

    const withdrawX3 = xInRange('30000', 4900, 5100, rate, false)
    
    const feeX3Expect = stringAdd(scale2Fee(feeScaleXMiner3_q128, '30000'), withdrawX3);
    console.log("expect feeX of miner3: ", feeX3Expect);
    expect(feeX3).to.equal(feeX3Expect);
    expect(feeY3).to.equal('0');

    await burn(poolAddr, miner1, 4850, 5000, 5000);
    const [liquid1, feeScaleX1, feeScaleY1, feeX1, feeY1] = await getLiquidity(testMint, tokenX, tokenY, miner1, 4850, 5000);
    console.log("feeX of miner1: ", feeX1);
    const feeScaleXMiner1_128 = getSum([feeScaleX_4950_5000, feeScaleX_4900_4950, feeScaleX_4870_4900_4869_Remain]);
    const [withdrawX1, withdrawY1, liquidityX_4869_AfterWithdraw] = getWithDraw(4869, 4850, 5000, '10000', liquidityX_4869, "5000", rate);
    console.log('withdraw x1: ', withdrawX1);
    const feeX1Expect = scale2Fee(feeScaleXMiner1_128, '10000');
    console.log("expect feeX of miner1: ", feeX1Expect);
    expect(feeX1).to.equal(stringAdd(feeX1Expect, withdrawX1));  
    expect(feeY1).to.equal(withdrawY1);

    const {currPt: currPtAfterWithdraw, liquidity: liquidityAfterWithdraw, liquidityX: liquidityXAfterWithdraw} = await printState(poolAddr);
    expect(currPtAfterWithdraw).to.equal(4869);
    expect(liquidityAfterWithdraw).to.equal("5000");
    expect(liquidityXAfterWithdraw).to.equal(liquidityX_4869_AfterWithdraw);

    // check liquidity remain and swap
    const acquireX_4869_trader3 = l2x(liquidityX_4869_AfterWithdraw, 4869, rate, false)
    const costY_4869_trader3 = l2y(liquidityX_4869_AfterWithdraw, 4869, rate, true)
    const costY_4869_WithFee_trader3 = amountAddFee(costY_4869_trader3);

    const acquireX_4870_5000_trader3 = xInRange("5000", 4870, 5000, rate, false);
    const costY_4870_5000_trader3 = yInRange("5000", 4870, 5000, rate, true);
    const costY_4870_5000_WithFee_trader3 = amountAddFee(costY_4870_5000_trader3);

    const acquireX_5050_5100_trader3 = xInRange("20000", 5050, 5100, rate, false);
    const costY_5050_5100_trader3 = yInRange("20000", 5050, 5100, rate, true);
    const costY_5050_5100_WithFee_trader3 = amountAddFee(costY_5050_5100_trader3);

    let acquireX_5100_Lim_trader3 = BigNumber("50000000");
    let costY_5100_Lim_trader3 = ceil(acquireX_5100_Lim_trader3.times(BigNumber(rate).pow(5100)));
    [acquireX_5100_Lim_trader3, costY_5100_Lim_trader3] = y2XAt(5100, rate, costY_5100_Lim_trader3);
    const costY_5100_Lim_WithFee_trader3 = amountAddFee(costY_5100_Lim_trader3);

    console.log('costY_4869_trader3: ', costY_4869_trader3)
    console.log('costY_4870_5000_trader3: ', costY_4870_5000_trader3)
    console.log('costY_5050_5100_trader3: ', costY_5050_5100_trader3)
    console.log('costY_5100_Lim_trader3: ', costY_5100_Lim_trader3)

    const  costYRange = getSum([
        costY_4869_WithFee_trader3,
        costY_4870_5000_WithFee_trader3,
        costY_5050_5100_WithFee_trader3,
        costY_5100_Lim_WithFee_trader3
    ]);

    const acquireXRange = getSum([
        acquireX_4869_trader3,
        acquireX_4870_5000_trader3,
        acquireX_5050_5100_trader3,
        acquireX_5100_Lim_trader3
    ])
    
    
    await tokenY.transfer(trader3.address, 10000000000);
    await tokenY.connect(trader3).approve(testSwap.address, stringMul(costYRange, '2'));
    await testSwap.connect(trader3).swapY2X(
        tokenX.address, tokenY.address, 3000, costYRange, 5200);
    expect(stringAdd(costYRange, (await tokenY.balanceOf(trader3.address)).toString())).to.equal("10000000000");
    expect(acquireXRange).to.equal((await tokenX.balanceOf(trader3.address)).toString());

    // check limit order
    await checkLimOrder(
        '100000000',
        '0',
        '0',

        "0",
        "0",
        '0',

        "0",
        "0",
        "0",
        "0",
        poolAddr,
        5150
    );
    console.log('aaaaaaaaaaa')
    await checkLimOrder(
        BigNumber("200000000").minus(acquireX_5100_Lim_trader3).toFixed(0),
        '0',
        '0',

        "0",
        costY_5100_Lim_trader3,
        '0',

        "0",
        costY_5100_Lim_trader3,
        
        '0',
        '0',

        poolAddr,
        5100
    );
  });
});