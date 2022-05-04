const { ethers } = require("hardhat");
const BigNumber = require('bignumber.js');
const { expect, use } = require("chai");

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

function stringMod(a, b) {
    let an = BigNumber(a);
    an = an.mod(b);
    return an.toFixed(0);
}

function stringDivCeil(a, b) {
    const div = stringDiv(a, b);
    if (stringMod(a, b) === '0') {
        return div;
    }
    return stringAdd(div, '1');
}

function stringAdd(a, b) {
    return BigNumber(a).plus(b).toFixed(0);
}

function stringLess(a, b) {
    return BigNumber(a).lt(b);
}

async function getPoolParts() {
    const SwapX2YModuleFactory = await ethers.getContractFactory("SwapX2YModule");
    const swapX2YModule = await SwapX2YModuleFactory.deploy();
    await swapX2YModule.deployed();
    
    const SwapY2XModuleFactory = await ethers.getContractFactory("SwapY2XModule");
    const swapY2XModule = await SwapY2XModuleFactory.deploy();
    await swapY2XModule.deployed();
  
    const LiquidityModuleFactory = await ethers.getContractFactory('LiquidityModule');
    const liquidityModule = await LiquidityModuleFactory.deploy();
    await liquidityModule.deployed();
  
    const LimitOrderModuleFactory = await ethers.getContractFactory('LimitOrderModule');
    const limitOrderModule = await LimitOrderModuleFactory.deploy();
    await limitOrderModule.deployed();

    const FlashModuleFactory = await ethers.getContractFactory('FlashModule');
    const flashModule = await FlashModuleFactory.deploy();
    await flashModule.deployed();
    return {
      swapX2YModule: swapX2YModule.address,
      swapY2XModule: swapY2XModule.address,
      liquidityModule: liquidityModule.address,
      limitOrderModule: limitOrderModule.address,
      flashModule: flashModule.address,
    };
  }

async function getLimOrder(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    const {sellingX, accEarnX, sellingY, accEarnY, earnX, earnY} = await pool.limitOrderData(pt);
    return {
        sellingX: BigNumber(sellingX._hex),
        accEarnX: BigNumber(accEarnX._hex),
        sellingY: BigNumber(sellingY._hex),
        accEarnY: BigNumber(accEarnY._hex),
        earnX: BigNumber(earnX._hex),
        earnY: BigNumber(earnY._hex)
    }
}

async function checkLimOrder(eSellingX, eAccEarnX, eSellingY, eAccEarnY, eEarnX, eEarnY, poolAddr, pt) {
    const {sellingX, accEarnX, sellingY, accEarnY, earnX, earnY} = await getLimOrder(poolAddr, pt);
    expect(sellingX.toFixed(0)).to.equal(eSellingX);
    expect(accEarnX.toFixed(0)).to.equal(eAccEarnX);
    expect(sellingY.toFixed(0)).to.equal(eSellingY);
    expect(accEarnY.toFixed(0)).to.equal(eAccEarnY);
    if (eEarnX)
    expect(earnX.toFixed(0)).to.equal(eEarnX);
    if (eEarnY)
    expect(earnY.toFixed(0)).to.equal(eEarnY);
}

function floor(a) {
    return a.toFixed(0, 3);
}
function ceil(b) {
    return b.toFixed(0, 2);
}
function getAcquiredFee(amount, chargePercent = 50) {
    const originFee = ceil(BigNumber(amount).times(3).div(997));
    const charged = floor(BigNumber(originFee).times(chargePercent).div(100));
    return BigNumber(originFee).minus(charged).toFixed(0);
}

function getFeeCharge(fee, chargePercent = 50) {
    return floor(BigNumber(fee).times(chargePercent).div('100'));
}

function getFeeChargeFromAmount(amount, fee=3000, chargePercent=50) {
    const originFee = stringDivCeil(stringMul(amount, fee), stringMinus(1e6, fee))
    return getFeeCharge(originFee, chargePercent);
}
function getFeeFromAmount(amount, fee=3000) {
    return stringDivCeil(stringMul(amount, fee), stringMinus(1e6, fee))
}

function yInRange(liquidity, pl, pr, rate, up) {
    let amountY = BigNumber("0");
    let price = BigNumber(rate).pow(pl);
    for (var i = pl; i < pr; i ++) {
        amountY = amountY.plus(BigNumber(liquidity).times(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountY);
    } else {
        return floor(amountY);
    }
}
function xInRange(liquidity, pl, pr, rate, up) {
    let amountX = BigNumber("0");
    let price = BigNumber(rate).pow(pl);
    for (var i = pl; i < pr; i ++) {
        amountX = amountX.plus(BigNumber(liquidity).div(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountX);
    } else {
        return floor(amountX);
    }
}

function getYRangeList(rangeList, rate, up) {
    const amountY = [];
    for (const range of rangeList) {
        amountY.push(yInRange(range.liquidity, range.pl, range.pr, rate, up));
    }
    return amountY;
}
function getXRangeList(rangeList, rate, up) {
    const amountX = [];
    for (const range of rangeList) {
        amountX.push(xInRange(range.liquidity, range.pl, range.pr, rate, up));
    }
    return amountX;
}

function y2xAt(point, rate, amountY) {
    const sp = rate.pow(point).sqrt();
    const liquidity = floor(BigNumber(amountY).div(sp));
    const acquireX = floor(BigNumber(liquidity).div(sp));
    const liquidity1 = ceil(BigNumber(acquireX).times(sp));
    const costY = ceil(BigNumber(liquidity1).times(sp));
    return [acquireX, costY];
}

function getCostYFromXAt(sqrtPrice_96, acquireX) {
    const q96 = BigNumber(2).pow(96).toFixed(0);

    const liquidity = stringDivCeil(stringMul(acquireX, sqrtPrice_96), q96);
    const costY = stringDivCeil(stringMul(liquidity, sqrtPrice_96), q96);

    return costY;
}

function getEarnYFromXAt(sqrtPrice_96, soldX) {
    const q96 = BigNumber(2).pow(96).toFixed(0);

    const liquidity = stringDiv(stringMul(soldX, sqrtPrice_96), q96);
    const costY = stringDiv(stringMul(liquidity, sqrtPrice_96), q96);

    return costY;
}

function getCostXFromYAt(sqrtPrice_96, acquireY) {
    const q96 = BigNumber(2).pow(96).toFixed(0);

    const liquidity = stringDivCeil(stringMul(acquireY, q96), sqrtPrice_96);
    const costX = stringDivCeil(stringMul(liquidity, q96), sqrtPrice_96);

    return costX;
}

function getEarnXFromYAt(sqrtPrice_96, costY) {
    const q96 = BigNumber(2).pow(96).toFixed(0);

    const liquidity = stringDiv(stringMul(costY, q96), sqrtPrice_96);
    const costX = stringDiv(stringMul(liquidity, q96), sqrtPrice_96);

    return costX;
}

function acquiredFeeLiquidity(amount, feeTier=3000, chargePercent=50) {

    const fee = stringDivCeil(stringMul(amount, feeTier), stringMinus(1e6, feeTier));
    return stringMinus(fee, getFeeCharge(fee, chargePercent));
}

function amountAddFee(amount, feeTier=3000) {
    const fee = stringDivCeil(stringMul(amount, feeTier), stringMinus(1e6, feeTier));
    return stringAdd(amount, fee);
}


function l2x(liquidity, sqrtPrice_96, up) {
    const q96 = BigNumber(2).pow(96).toFixed(0);
    if (up) {
        return stringDivCeil(stringMul(liquidity, q96), sqrtPrice_96)
    } else {
        return stringDiv(stringMul(liquidity, q96), sqrtPrice_96)
    }
}

function l2y(liquidity, sqrtPrice_96, up) {
    const q96 = BigNumber(2).pow(96).toFixed(0);
    if (up) {
        return stringDivCeil(stringMul(liquidity, sqrtPrice_96), q96)
    } else {
        return stringDiv(stringMul(liquidity, sqrtPrice_96), q96)
    }
}

  
async function getState(pool) {
    const {sqrtPrice_96, currentPoint, liquidity, liquidityX, observationCurrentIndex, observationQueueLen, observationNextQueueLen } = await pool.state();
    return {
        sqrtPrice_96: sqrtPrice_96.toString(),
        currentPoint: currentPoint.toString(),
        liquidity: liquidity.toString(),
        liquidityX: liquidityX.toString(),
        observationCurrentIndex: observationCurrentIndex.toString(),
        observationQueueLen: observationQueueLen.toString(),
        observationNextQueueLen: observationNextQueueLen.toString()
    }
}

async function addLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr, liquidity) {
    await testMint.connect(miner).mint(tokenX.address, tokenY.address, fee, pl, pr, liquidity);
}
module.exports ={
    getPoolParts,
    getLimOrder,
    getAcquiredFee,
    getFeeCharge,
    getYRangeList,
    getXRangeList,
    xInRange,
    yInRange,
    y2xAt,
    getCostYFromXAt,
    getCostXFromYAt,
    acquiredFeeLiquidity,
    amountAddFee,
    l2x,
    l2y,
    getState,
    addLiquidity,
    checkLimOrder,
    stringAdd,
    stringMod,
    stringMinus,
    stringMul,
    stringDivCeil,
    stringDiv,
    getEarnYFromXAt,
    getEarnXFromYAt,
    getFeeChargeFromAmount,
    getFeeFromAmount
}