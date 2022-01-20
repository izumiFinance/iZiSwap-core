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
  const IZiSwapPool = await ethers.getContractFactory("IZiSwapPool");
  pool = await IZiSwapPool.attach(poolAddr);
  [sqrtPrice_96, currPt, currX, currY, liquidity, allX, locked] = await pool.state();
  return [currPt, BigNumber(currX._hex), BigNumber(currY._hex), BigNumber(liquidity._hex), allX, locked]
}

async function getLimOrder(poolAddr, pt) {
    const IZiSwapPool = await ethers.getContractFactory("IZiSwapPool");
    pool = await IZiSwapPool.attach(poolAddr);
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
    const IZiSwapPool = await ethers.getContractFactory("IZiSwapPool");
    pool = await IZiSwapPool.attach(poolAddr);
    return await pool.statusVal(pt / 50);
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
function y2xAt(point, rate, amountY) {
    sp = rate.pow(point).sqrt();
    liquidity = ceil(amountY.div(sp));
    costX = ceil(liquidity.div(sp));
    return costX;
}
function x2yAtLiquidity(point, rate, amountX, currX, currY, liquidity) {
    sp = rate.pow(point).sqrt();
    currXLim = ceil(liquidity.div(sp));
    deltaX = BigNumber('0');
    if (currXLim.gte(currX)) {
        deltaX = currXLim.minus(currX);
    }
    if (amountX.gte(deltaX)) {
        return [currY, deltaX];
    }
    acquireY = floor(amountX.times(currY).div(deltaX));
    if (acquireY.eq('0')) {
        return [BigNumber('0'), BigNumber('0')];
    }
    return [acquireY, amountX];
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
    return ceil(amount.times(1003).div(1000));
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

async function getPoolParts() {
    const IZiSwapPoolPartFactory = await ethers.getContractFactory("SwapX2YModule");
    const IZiSwapPoolPart = await IZiSwapPoolPartFactory.deploy();
    await IZiSwapPoolPart.deployed();
    const IZiSwapPoolPartDesireFactory = await ethers.getContractFactory("SwapY2XModule");
    const IZiSwapPoolPartDesire = await IZiSwapPoolPartDesireFactory.deploy();
    await IZiSwapPoolPartDesire.deployed();
    return [IZiSwapPoolPart.address, IZiSwapPoolPartDesire.address];
  }
function getFee(amount) {
    return ceil(amount.times(3).div(1000));
}
async function burn(poolAddr, miner, pl, pr, liquidDelta) {
    const IZiSwapPool = await ethers.getContractFactory("IZiSwapPool");
    pool = await IZiSwapPool.attach(poolAddr);
    await pool.connect(miner).burn(pl, pr, liquidDelta);
}
async function getLiquidity(testMint, tokenX, tokenY, miner, pl, pr) {
    [liquidity, lastFeeScaleX_128, lastFeeScaleY_128, remainFeeX, remainFeeY] = await testMint.connect(miner).liquidities(
        tokenX.address, tokenY.address, 3000, pl, pr
    );
    return [
        BigNumber(liquidity._hex),
        BigNumber(lastFeeScaleX_128._hex),
        BigNumber(lastFeeScaleY_128._hex),
        BigNumber(remainFeeX._hex),
        BigNumber(remainFeeY._hex)
    ]
}
describe("swap", function () {
  it("swap with limorder x2y range complex", async function () {
    const [signer, miner1, miner2, miner3, seller0, seller1, trader, trader2] = await ethers.getSigners();

    [poolPart, poolPartDesire] = await getPoolParts();
    // deploy a factory
    const IZiSwapFactory = await ethers.getContractFactory("IZiSwapFactory");

    const factory = await IZiSwapFactory.deploy(poolPart, poolPartDesire);
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

    [currPt, currX, currY, liquidity, allX, locked] = await printState(poolAddr);
    expect(currX.toFixed(0)).to.equal('0');
    y_5100_Liquid = l2y(BigNumber("20000"), 5100, rate, true);
    expect(y_5100_Liquid.toFixed(0)).to.equal(currY.toFixed(0));
    // part of y of 5100 from liquidity
    acquireY_5100 = BigNumber(y_5100_Liquid.times(5).div(16).toFixed(0));
    costX_5100 = y2xAt(5100, rate, acquireY_5100);
    [acquireY_5100, costX_5100] = x2yAtLiquidity(5100, rate, costX_5100, currX, currY, BigNumber("20000"));
    console.log("acquire y expect: ", acquireY_5100.toFixed(0));
    costX_5100_WithFee = amountAddFee(costX_5100);
    feeScaleX_5100_Trader1 = getFee(costX_5100).div(BigNumber("20000"));
    
    // contract to call swap
    const testSwapFactory = await ethers.getContractFactory("TestSwap");
    const testSwap = await testSwapFactory.deploy(factory.address);
    await testSwap.deployed();
    await tokenX.transfer(trader.address, 10000000000);
    await tokenX.connect(trader).approve(testSwap.address, costX_5100_WithFee.times(2).toFixed(0));
    // trader swap to acquire y
    await testSwap.connect(trader).swapX2Y(
        tokenX.address, tokenY.address, 3000, costX_5100_WithFee.toFixed(0), 5100);
    // check cost and acquire of trader
    expect(costX_5100_WithFee.plus(blockNum2BigNumber(await tokenX.balanceOf(trader.address))).toFixed(0)).to.equal("10000000000");

    expect(acquireY_5100.toFixed(0)).to.equal(blockNum2BigNumber(await tokenY.balanceOf(trader.address)).toFixed(0));

    [currPt, currX, currY, liquidity, allX, locked] = await printState(poolAddr);
    expect(currY.plus(acquireY_5100).toFixed(0)).to.equal(y_5100_Liquid.toFixed(0));
    expect(currX.toFixed(0)).to.equal(costX_5100.toFixed(0));

    // now for trader2
    // trader 2 sell x to acquire y
    acquireY_5100_Remain = currY.plus('0');
    currXLim = l2x(BigNumber("20000"), 5100, rate, true);
    costX_5100_Remain = currXLim.minus(currX);
    feeScaleX_5100_Remain = getFee(costX_5100_Remain).div(BigNumber("20000"));
    acquireY_5050_5100 = yInRange(BigNumber("50000"), 5050, 5100, rate, false);
    costX_5050_5100 = xInRange(BigNumber("50000"), 5050, 5100, rate, true);
    feeScaleX_5050_5100 = getFee(costX_5050_5100).div(BigNumber("50000"));
    acquireY_5000_5050 = yInRange(BigNumber("30000"), 5000, 5050, rate, false);
    costX_5000_5050 = xInRange(BigNumber("30000"), 5000, 5050, rate, true);
    feeScaleX_5000_5050 = getFee(costX_5000_5050).div(BigNumber("30000"));
    
    // a lim order at 4950 split the liquid
    acquireY_4950_5000 = yInRange(BigNumber("40000"), 4950, 5000, rate, false);
    costX_4950_5000 = xInRange(BigNumber("40000"), 4950, 5000, rate, true);
    feeScaleX_4950_5000 = getFee(costX_4950_5000).div(BigNumber("40000"));
    acquireY_4900_4950 = yInRange(BigNumber("40000"), 4900, 4950, rate, false);
    costX_4900_4950 = xInRange(BigNumber("40000"), 4900, 4950, rate, true);
    feeScaleX_4900_4950 = getFee(costX_4900_4950).div(BigNumber("40000"));

    acquireY_4870_4900 = yInRange(BigNumber("10000"), 4870, 4900, rate, false);
    costX_4870_4900 = xInRange(BigNumber("10000"), 4870, 4900, rate, true);
    amountY_4869_Liquid = l2y(BigNumber("10000"), 4869, rate, false);
    acquireY_4869_Remain = BigNumber(amountY_4869_Liquid.times(2).div(11).toFixed(0));
    costX_4869_Remain = y2xAt(4869, rate, acquireY_4869_Remain);
    [acquireY_4869_Remain, costX_4869_Remain] = x2yAtLiquidity(4869, rate, costX_4869_Remain, BigNumber('0'), amountY_4869_Liquid, BigNumber("10000"));
    feeScaleX_4870_4900_4869_Remain = getFee(costX_4870_4900.plus(costX_4869_Remain)).div(BigNumber("10000"));
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
    
    
    costXRangeWithFee = amountAddFee(costX_5100_Remain).plus(
        amountAddFee(costX_5050_5100)).plus(
        amountAddFee(costX_5000_5050)).plus(
        amountAddFee(costX_4950_5000)).plus(
        amountAddFee(costX_4900_4950)).plus(
        amountAddFee(costX_4870_4900)).plus(
        amountAddFee(costX_4869_Remain)).plus(costX_5050_Lim).plus(costX_4950_Lim);

    await tokenX.transfer(trader2.address, 10000000000);
    await tokenX.connect(trader2).approve(testSwap.address, costXRangeWithFee.times(2).toFixed(0));
    // trader2 swap to acquire y
    await testSwap.connect(trader2).swapX2Y(
        tokenX.address, tokenY.address, 3000, costXRangeWithFee.toFixed(0), 4860);
    // check cost and acquire of trader
    expect(costXRangeWithFee.plus(blockNum2BigNumber(await tokenX.balanceOf(trader2.address))).toFixed(0)).to.equal("10000000000");
    expect(acquireYRange.toFixed(0)).to.equal(blockNum2BigNumber(await tokenY.balanceOf(trader2.address)).toFixed(0));
    
    // check status at curr point after swap
    [currPt, currX, currY, liquidity, allX, locked] = await printState(poolAddr);
    expect(currPt).to.equal(4869);
    expect(liquidity.toFixed(0)).to.equal("10000");
    expect(currX.toFixed(0)).to.equal(costX_4869_Remain.toFixed(0));
    expect(currY.toFixed(0)).to.equal(amountY_4869_Liquid.minus(acquireY_4869_Remain).toFixed(0));

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
    q128 = BigNumber(2).pow(128);
    feeScaleXMiner2_q128 = floor(feeScaleX_5100_Trader1.times(q128)).plus(floor(feeScaleX_5100_Remain.times(q128))).plus(floor(feeScaleX_5050_5100.times(q128)));

    mul = floor(feeScaleXMiner2_q128.times(BigNumber("20000")));
    
    expectFeeX2 = floor(mul.minus(mul.mod(q128)).div(q128)).toFixed(0);
    console.log("expect feeY of miner2: ", expectFeeX2);
    expect(feeX2.toFixed(0)).to.equal(expectFeeX2);

    await burn(poolAddr, miner3, 4900, 5100, 0);
    [liquid3, feeScaleX3, feeScaleY3, feeX3, feeY3] = await getLiquidity(testMint, tokenX, tokenY, miner3, 4900, 5100);
    console.log("feeX of miner3: ", feeX3.toFixed(0));
    feeScaleXMiner3 = feeScaleX_5050_5100.plus(feeScaleX_5000_5050).plus(feeScaleX_4950_5000).plus(feeScaleX_4900_4950);

    console.log("expect feeY of miner3: ", floor(feeScaleXMiner3.times(BigNumber("30000"))).toFixed(0));
    expect(feeX3.toFixed(0)).to.equal(floor(feeScaleXMiner3.times(BigNumber("30000"))).toFixed(0));

    await burn(poolAddr, miner1, 4850, 5000, 0);
    [liquid1, feeScaleX1, feeScaleY1, feeX1, feeY1] = await getLiquidity(testMint, tokenX, tokenY, miner1, 4850, 5000);
    console.log("feeX of miner1: ", feeX1.toFixed(0));
    feeScaleXMiner1 = feeScaleX_4950_5000.plus(feeScaleX_4900_4950).plus(feeScaleX_4870_4900_4869_Remain);

    console.log("expect feeX of miner3: ", floor(feeScaleXMiner1.times(BigNumber("10000"))).toFixed(0));
    expect(feeX1.toFixed(0)).to.equal(floor(feeScaleXMiner1.times(BigNumber("10000"))).toFixed(0));  
  });
});