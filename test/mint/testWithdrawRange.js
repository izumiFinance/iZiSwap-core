const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");
const { decryptJsonWallet } = require("@ethersproject/json-wallets");

var tokenX;
var tokenY;

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
async function getLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr) {
    const ret = await testMint.connect(miner).liquidities(tokenX.address, tokenY.address, fee, pl, pr);
    return {
        liquidity: ret.liquidity.toString(),
        lastFeeScaleX_128: ret.lastFeeScaleX_128.toString(),
        lastFeeScaleY_128: ret.lastFeeScaleY_128.toString(),
        tokenOwedX: ret.tokenOwedX.toString(),
        tokenOwedY: ret.tokenOwedY.toString()
    }
}


async function addLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr, liquidity) {
    const poolAddr = await testMint.pool(tokenX.address, tokenY.address, fee);
    const balanceXBefore = (await tokenX.balanceOf(miner.address)).toString();
    const balanceYBefore = (await tokenY.balanceOf(miner.address)).toString();
    const balancePoolXBefore = (await tokenX.balanceOf(poolAddr)).toString();
    const balancePoolYBefore = (await tokenY.balanceOf(poolAddr)).toString();
    let ok = false;
    try {
        await testMint.connect(miner).mint(tokenX.address, tokenY.address, fee, pl, pr, liquidity);
        ok = true;
    } catch(err) {
        ok = false;
    }
    const balanceXAfter = (await tokenX.balanceOf(miner.address)).toString();
    const balanceYAfter = (await tokenY.balanceOf(miner.address)).toString();
    const balancePoolXAfter = (await tokenX.balanceOf(poolAddr)).toString();
    const balancePoolYAfter = (await tokenY.balanceOf(poolAddr)).toString();
    return {
        ok,
        payedX: stringMinus(balanceXBefore, balanceXAfter),
        payedY: stringMinus(balanceYBefore, balanceYAfter),
        receivedX: stringMinus(balancePoolXAfter, balancePoolXBefore),
        receivedY: stringMinus(balancePoolYAfter, balancePoolYBefore)
    }

}


async function getState(pool) {
    const {sqrtPrice_96, currentPoint, liquidity, liquidityX} = await pool.state();
    return {
        sqrtPrice_96: sqrtPrice_96.toString(),
        currentPoint: currentPoint.toString(),
        liquidity: liquidity.toString(),
        liquidityX: liquidityX.toString()
    }
}

function floor(a) {
    return BigNumber(a.toFixed(0, 3));
}
function ceil(b) {
    return BigNumber(b.toFixed(0, 2));
}

function limitCostY(point, rate, amountX, maxAmountX) {
    const sp = BigNumber(rate).pow(point).sqrt();
    let liquidity = ceil(BigNumber(amountX).times(sp));
    const costY = ceil(liquidity.times(sp)).toFixed(0, 3);

    liquidity = floor(BigNumber(costY).div(sp));
    let acquireX = floor(liquidity.div(sp)).toFixed(0, 3);
    if (stringLess(maxAmountX, acquireX)) {
        acquireX = maxAmountX;
    }
    return {acquireX, costY};
}

function getFee(cost, fee) {
    return ceil(BigNumber(cost).times(fee).div(1e6-fee)).toFixed(0);
}

function getFeeCharge(fee) {
    return floor(BigNumber(fee).times('20').div('100')).toFixed(0);
}

function getFeeAcquire(fee) {
    const feeCharged = getFeeCharge(fee);
    return stringMinus(fee, feeCharged);
}

function getFeeAcquireFromCost(cost) {
    const fee = getFee(cost, '3000');
    return getFeeAcquire(fee);
}

function yInRange(liquidity, pl, pr, rate, up) {
    let amountY = BigNumber("0");
    let price = BigNumber(rate).pow(pl);
    for (var i = pl; i < pr; i ++) {
        amountY = amountY.plus(BigNumber(liquidity).times(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountY).toFixed(0);
    } else {
        return floor(amountY).toFixed(0);
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
        return ceil(amountX).toFixed(0);
    } else {
        return floor(amountX).toFixed(0);
    }
}


function l2x(liquidity, tick, rate, up) {
    const price = BigNumber(rate).pow(tick);
    const x = BigNumber(liquidity).div(price.sqrt());
    if (up) {
        return x.toFixed(0, 2);
    } else {
        return x.toFixed(0, 3);
    }
}
function l2y(liquidity, tick, rate, up) {
    const price = BigNumber(rate).pow(tick);
    const x = BigNumber(liquidity).times(price.sqrt());
    if (up) {
        return x.toFixed(0, 2);
    } else {
        return x.toFixed(0, 3);
    }
}
function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex);
}
function amountAddFee(amount) {
    return ceil(amount.times(1000).div(997));
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
function getFeeOfList(costList, fee) {
    const feeList = costList.map((c)=>{
        return getFee(c, fee);
    });
    const feeAcquireList = feeList.map((f)=>{
        return getFeeAcquire(f);
    });
    return {feeList, feeAcquireList};
}

function getSum(amountList) {
    let res = '0';
    for (let a of amountList) {
        res = stringAdd(res, a);
    }
    return res;
}


async function getDeltaFeeScale(testMint, pool, miner, leftPt, rightPt) {

    const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner, tokenX, tokenY, 3000, leftPt, rightPt);
    await pool.connect(miner).burn(leftPt, rightPt, 0);

    const {lastFeeScaleX_128: newScaleX, lastFeeScaleY_128: newScaleY} = await getLiquidity(testMint, miner, tokenX, tokenY, 3000, leftPt, rightPt);

    const q256 = BigNumber(2).pow(256).toFixed(0);

    const deltaScaleX = stringLess(newScaleX, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX, q256), lastFeeScaleX_128) : stringMinus(newScaleX, lastFeeScaleX_128);
    const deltaScaleY = stringLess(newScaleY, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY, q256), lastFeeScaleY_128) : stringMinus(newScaleY, lastFeeScaleY_128);

    return {deltaScaleX, deltaScaleY};
}

async function getAbsFeeScale(testMint, miner, leftPt, rightPt) {
    const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner, tokenX, tokenY, 3000, leftPt, rightPt);
    return {lastFeeScaleX_128, lastFeeScaleY_128}
}

async function getPoint(pool, point) {
    const {liquidSum, liquidDelta, accFeeXOut_128, accFeeYOut_128, isEndpt} = await pool.points(point);
    return {
        liquidSum: liquidSum.toString(),
        liquidDelta: liquidDelta.toString(),
        accFeeXOut_128: accFeeXOut_128.toString(),
        accFeeYOut_128: accFeeYOut_128.toString(),
        isEndpt
    };
}

function feeScaleFromCost(cost, liquidity) {
    const fee = getFeeAcquireFromCost(cost);
    const q128 = BigNumber(2).pow(128).toFixed(0);
    return stringDiv(stringMul(fee, q128), liquidity);
}

function feeScale2Fee(feeScale, liquidity) {
    const q128 = BigNumber(2).pow(128).toFixed(0);
    return stringDiv(stringMul(feeScale, liquidity), q128);
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
    const pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}

async function getBitsFromPool(poolAddr, idx) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    const pool = await iZiSwapPool.attach(poolAddr);
    return (await pool.pointBitmap(idx)).toString();
}

function getExpectBits(idx, pointList) {
    const pointLeft = idx * 50 * 256;
    const pointRight = pointLeft + 50 * 256;
    let bits = BigNumber(0);
    for (point of pointList) {
        if (point >= pointLeft && point < pointRight) {
            const pos = Math.round((point - pointLeft) / 50);
            bits = bits.plus(BigNumber(2).pow(pos));
        }
    }
    return bits.toFixed(0, 3);
}

describe("swap", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var poolAddr;
    var pool;
    var testMint;
    var testSwap;
    var q128;
    var q256;
    var expectFeeScaleX, expectFeeScaleX;
    var testAddLimOrder;
    beforeEach(async function() {
        [signer, miner, miner1, miner2, miner3, trader, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, mintModule, limitOrderModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, mintModule, limitOrderModule);
        await factory.deployed();

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, 5000);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);

        await tokenX.mint(miner.address, '1000000000000000000000000000000');
        await tokenY.mint(miner.address, '1000000000000000000000000000000');
        await tokenX.mint(miner1.address, '1000000000000000000000000000000');
        await tokenY.mint(miner1.address, '1000000000000000000000000000000');
        await tokenX.mint(miner2.address, '1000000000000000000000000000000');
        await tokenY.mint(miner2.address, '1000000000000000000000000000000');
        await tokenX.mint(trader.address, '1000000000000000000000000000000');
        await tokenY.mint(trader.address, '1000000000000000000000000000000');

        // test mint
        const testMintFactory = await ethers.getContractFactory("TestMint");
        testMint = await testMintFactory.deploy(factory.address);
        await testMint.deployed();

        const testSwapFactory = await ethers.getContractFactory('TestSwap');
        testSwap = await testSwapFactory.deploy(factory.address);
        await testSwap.deployed();

        const getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);
        expect(getPoolAddr.toLowerCase()).to.equal(poolAddr.toLowerCase());

        const poolFactory = await ethers.getContractFactory('iZiSwapPool');
        pool = await poolFactory.attach(poolAddr);

        await tokenX.connect(miner).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

        await addLiquidity(testMint, miner, tokenX, tokenY, 3000, -10000, 10000, '10000');

    });

    it("rightPt = currentPoint", async function () {

        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 6001);

        const costX_M2000_0 = xInRange('40000', -2000, 0, '1.0001', true);
        const costX_0_5001 = xInRange('40000', 0, 5001, '1.0001', true);
        const feeXScale = stringAdd(
            feeScaleFromCost(costX_M2000_0, '40000'),
            feeScaleFromCost(costX_0_5001, '40000'),
        );
        const costY_M2000_M50 = yInRange('40000', -2000, -50, '1.0001', true);
        const costY_M50_6000 = yInRange('40000', -50, 6000, '1.0001', true);
        const feeYScale = stringAdd(
            feeScaleFromCost(costY_M2000_M50, '40000'),
            feeScaleFromCost(costY_M50_6000, '40000'),
        );

        await pool.connect(miner1).burn(-2000, 6000, '30000');

        const withdrawY = yInRange('30000', -2000, 6000, '1.0001', false);

        const liquidity = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000);
        expect(liquidity.liquidity).to.equal('0');
        expect(liquidity.lastFeeScaleX_128).to.equal(feeXScale);
        expect(liquidity.lastFeeScaleY_128).to.equal(feeYScale);
        expect(liquidity.tokenOwedX).to.equal(feeScale2Fee(feeXScale, '30000'));
        expect(liquidity.tokenOwedY).to.equal(stringAdd(feeScale2Fee(feeYScale, '30000'), withdrawY));
    });

    it("rightPt < currentPoint", async function () {

        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);

        const costX_M2000_0 = xInRange('40000', -2000, 0, '1.0001', true);
        const costX_0_5001 = xInRange('40000', 0, 5001, '1.0001', true);
        const feeXScale = stringAdd(
            feeScaleFromCost(costX_M2000_0, '40000'),
            feeScaleFromCost(costX_0_5001, '40000'),
        );
        const costY_M2000_M50 = yInRange('40000', -2000, -50, '1.0001', true);
        const costY_M50_6000 = yInRange('40000', -50, 6000, '1.0001', true);
        const feeYScale = stringAdd(
            feeScaleFromCost(costY_M2000_M50, '40000'),
            feeScaleFromCost(costY_M50_6000, '40000'),
        );

        await pool.connect(miner1).burn(-2000, 6000, '30000');

        const withdrawY = yInRange('30000', -2000, 6000, '1.0001', false);

        const liquidity = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000);
        expect(liquidity.liquidity).to.equal('0');
        expect(liquidity.lastFeeScaleX_128).to.equal(feeXScale);
        expect(liquidity.lastFeeScaleY_128).to.equal(feeYScale);
        expect(liquidity.tokenOwedX).to.equal(feeScale2Fee(feeXScale, '30000'));
        expect(liquidity.tokenOwedY).to.equal(stringAdd(feeScale2Fee(feeYScale, '30000'), withdrawY));
    });

    it("leftPt > currentPoint", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -2001);

        const costY_5001_6000 = yInRange('40000', 5001, 6000, '1.0001', true);

        const feeYScale = feeScaleFromCost(costY_5001_6000, '40000');
        const costX_0_6000 = xInRange('40000', 0, 6000, '1.0001', true);
        const costX_M2000_0 = xInRange('40000', -2000, 0, '1.0001', true);
        const feeXScale = stringAdd(
            feeScaleFromCost(costX_M2000_0, '40000'),
            feeScaleFromCost(costX_0_6000, '40000'),
        );

        await pool.connect(miner1).burn(-2000, 6000, '30000');

        const withdrawX = xInRange('30000', -2000, 6000, '1.0001', false);

        const liquidity = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000);
        expect(liquidity.liquidity).to.equal('0');
        expect(liquidity.lastFeeScaleX_128).to.equal(feeXScale);
        expect(liquidity.lastFeeScaleY_128).to.equal(feeYScale);
        expect(liquidity.tokenOwedX).to.equal(stringAdd(feeScale2Fee(feeXScale, '30000'), withdrawX));
        expect(liquidity.tokenOwedY).to.equal(feeScale2Fee(feeYScale, '30000'));
    });

    it("leftPt = currentPoint, liquidityY at currentPoint is enough", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1999);

        const l2x_M2000 = l2x('5000', -2000, '1.0001', true);
        const costX_M2000 = ceil(BigNumber(l2x_M2000).times(1000).div(997)).toFixed(0);
        console.log('costX_M2000: ', costX_M2000, l2x_M2000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costX_M2000, -2000);
        const startState = await getState(pool);

        console.log('start state: ', startState);
        const liquidityY = stringMinus(startState.liquidity, startState.liquidityX);
        expect(liquidityY).to.equal('35000');

        const costY_5001_6000 = yInRange('40000', 5001, 6000, '1.0001', true);

        const feeYScale = feeScaleFromCost(costY_5001_6000, '40000');
        const costX_0_6000 = xInRange('40000', 0, 6000, '1.0001', true);
        const costX_M1999_0 = xInRange('40000', -1999, 0, '1.0001', true);
        const feeXScale = getSum([
            feeScaleFromCost(costX_M2000, '40000'),
            feeScaleFromCost(costX_M1999_0, '40000'),
            feeScaleFromCost(costX_0_6000, '40000')]
        );

        await pool.connect(miner1).burn(-2000, 6000, '30000');

        const withdrawX_1 = xInRange('30000', -1999, 6000, '1.0001', false);
        const withdrawY_1 = l2y('30000', -2000, '1.0001', false);

        const liquidity = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000);
        expect(liquidity.liquidity).to.equal('0');
        expect(liquidity.lastFeeScaleX_128).to.equal(feeXScale);
        expect(liquidity.lastFeeScaleY_128).to.equal(feeYScale);
        expect(liquidity.tokenOwedX).to.equal(stringAdd(feeScale2Fee(feeXScale, '30000'), withdrawX_1));
        expect(liquidity.tokenOwedY).to.equal(stringAdd(feeScale2Fee(feeYScale, '30000'), withdrawY_1));

    });

    it("leftPt < currentPoint, liquidityY at currentPoint is just enough", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1999);

        const l2x_M2000 = l2x('10000', -2000, '1.0001', true);
        const costX_M2000 = ceil(BigNumber(l2x_M2000).times(1000).div(997)).toFixed(0);
        console.log('costX_M2000: ', costX_M2000, l2x_M2000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costX_M2000, -2000);
        const startState = await getState(pool);

        console.log('start state: ', startState);
        const liquidityY = stringMinus(startState.liquidity, startState.liquidityX);
        expect(liquidityY).to.equal('30000');

        const costY_5001_6000 = yInRange('40000', 5001, 6000, '1.0001', true);

        const feeYScale = feeScaleFromCost(costY_5001_6000, '40000');
        const costX_0_6000 = xInRange('40000', 0, 6000, '1.0001', true);
        const costX_M1999_0 = xInRange('40000', -1999, 0, '1.0001', true);
        const feeXScale = getSum([
            feeScaleFromCost(costX_M2000, '40000'),
            feeScaleFromCost(costX_M1999_0, '40000'),
            feeScaleFromCost(costX_0_6000, '40000')]
        );

        await pool.connect(miner1).burn(-4000, 6000, '30000');

        const withdrawX_1 = xInRange('30000', -1999, 6000, '1.0001', false);
        const withdrawY_1 = stringAdd(
            l2y('30000', -2000, '1.0001', false),
            yInRange('30000', -4000, -2000, '1.0001', false)
        );

        const liquidity = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity.liquidity).to.equal('0');
        expect(liquidity.lastFeeScaleX_128).to.equal(feeXScale);
        expect(liquidity.lastFeeScaleY_128).to.equal(feeYScale);
        expect(liquidity.tokenOwedX).to.equal(stringAdd(feeScale2Fee(feeXScale, '30000'), withdrawX_1));
        expect(liquidity.tokenOwedY).to.equal(stringAdd(feeScale2Fee(feeYScale, '30000'), withdrawY_1));

    });

    it("leftPt < currentPoint, liquidityY at currentPoint is not enough", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1999);

        const l2x_M2000 = l2x('20000', -2000, '1.0001', true);
        const costX_M2000 = ceil(BigNumber(l2x_M2000).times(1000).div(997)).toFixed(0);
        console.log('costX_M2000: ', costX_M2000, l2x_M2000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costX_M2000, -2000);
        const startState = await getState(pool);

        console.log('start state: ', startState);
        const liquidityY = stringMinus(startState.liquidity, startState.liquidityX);
        expect(liquidityY).to.equal('20000');

        const costY_5001_6000 = yInRange('40000', 5001, 6000, '1.0001', true);

        const feeYScale = feeScaleFromCost(costY_5001_6000, '40000');
        const costX_0_6000 = xInRange('40000', 0, 6000, '1.0001', true);
        const costX_M1999_0 = xInRange('40000', -1999, 0, '1.0001', true);
        const feeXScale = getSum([
            feeScaleFromCost(costX_M2000, '40000'),
            feeScaleFromCost(costX_M1999_0, '40000'),
            feeScaleFromCost(costX_0_6000, '40000')]
        );

        await pool.connect(miner1).burn(-4000, 6000, '30000');

        const withdrawX_1 = stringAdd(
            l2x('10000', -2000, '1.0001', false),
            xInRange('30000', -1999, 6000, '1.0001', false)
        );
        const withdrawY_1 = stringAdd(
            l2y('20000', -2000, '1.0001', false),
            yInRange('30000', -4000, -2000, '1.0001', false)
        );

        const liquidity = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity.liquidity).to.equal('0');
        expect(liquidity.lastFeeScaleX_128).to.equal(feeXScale);
        expect(liquidity.lastFeeScaleY_128).to.equal(feeYScale);
        expect(liquidity.tokenOwedX).to.equal(stringAdd(feeScale2Fee(feeXScale, '30000'), withdrawX_1));
        expect(liquidity.tokenOwedY).to.equal(stringAdd(feeScale2Fee(feeYScale, '30000'), withdrawY_1));

    });

    it("leftPt = currentPoint - 1, liquidityY at currentPoint is not enough", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1998);

        const l2x_M1999 = l2x('20000', -1999, '1.0001', true);
        const costX_M1999 = ceil(BigNumber(l2x_M1999).times(1000).div(997)).toFixed(0);
        console.log('costX_M1999: ', costX_M1999, l2x_M1999);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costX_M1999, -1999);
        const startState = await getState(pool);

        console.log('start state: ', startState);
        const liquidityY = stringMinus(startState.liquidity, startState.liquidityX);
        expect(liquidityY).to.equal('20000');

        const costY_5001_6000 = yInRange('40000', 5001, 6000, '1.0001', true);

        const feeYScale = feeScaleFromCost(costY_5001_6000, '40000');
        const costX_0_6000 = xInRange('40000', 0, 6000, '1.0001', true);
        const costX_M1998_0 = xInRange('40000', -1998, 0, '1.0001', true);
        const feeXScale = getSum([
            feeScaleFromCost(costX_M1999, '40000'),
            feeScaleFromCost(costX_M1998_0, '40000'),
            feeScaleFromCost(costX_0_6000, '40000')]
        );

        await pool.connect(miner1).burn(-2000, 6000, '30000');

        const withdrawX_1 = stringAdd(
            l2x('10000', -1999, '1.0001', false),
            xInRange('30000', -1998, 6000, '1.0001', false)
        );
        const withdrawY_1 = stringAdd(
            l2y('20000', -1999, '1.0001', false),
            yInRange('30000', -2000, -1999, '1.0001', false)
        );

        const liquidity = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 6000);
        expect(liquidity.liquidity).to.equal('0');
        expect(liquidity.lastFeeScaleX_128).to.equal(feeXScale);
        expect(liquidity.lastFeeScaleY_128).to.equal(feeYScale);
        expect(liquidity.tokenOwedX).to.equal(stringAdd(feeScale2Fee(feeXScale, '30000'), withdrawX_1));
        expect(liquidity.tokenOwedY).to.equal(stringAdd(feeScale2Fee(feeYScale, '30000'), withdrawY_1));

        const state = await getState(pool);
        expect(state.currentPoint).to.equal('-1999')
        expect(state.liquidity).to.equal('10000');
        expect(state.liquidityX).to.equal('10000');

    });

    it("leftPt < currentPoint, burn add burn", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1999);

        const l2x_M2000_1 = l2x('10000', -2000, '1.0001', true);
        const costX_M2000_1 = ceil(BigNumber(l2x_M2000_1).times(1000).div(997)).toFixed(0);
        console.log('costX_M2000: ', costX_M2000_1, l2x_M2000_1);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costX_M2000_1, -2000);
        const state_1 = await getState(pool);

        console.log('start state: ', state_1);
        const liquidityY_1 = stringMinus(state_1.liquidity, state_1.liquidityX);
        expect(liquidityY_1).to.equal('30000');

        const costY_5001_6000_1 = yInRange('40000', 5001, 6000, '1.0001', true);

        const feeYScale_1 = feeScaleFromCost(costY_5001_6000_1, '40000');
        const costX_0_6000_1 = xInRange('40000', 0, 6000, '1.0001', true);
        const costX_M1999_0_1 = xInRange('40000', -1999, 0, '1.0001', true);
        const feeXScale_1 = getSum([
            feeScaleFromCost(l2x_M2000_1, '40000'),
            feeScaleFromCost(costX_M1999_0_1, '40000'),
            feeScaleFromCost(costX_0_6000_1, '40000')]
        );

        await pool.connect(miner1).burn(-4000, 6000, '20000');

        const withdrawX_1 = xInRange('20000', -1999, 6000, '1.0001', false)
        const withdrawY_1 = stringAdd(
            l2y('20000', -2000, '1.0001', false),
            yInRange('20000', -4000, -2000, '1.0001', false)
        );

        const liquidity_1 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity_1.liquidity).to.equal('10000');
        expect(liquidity_1.lastFeeScaleX_128).to.equal(feeXScale_1);
        expect(liquidity_1.lastFeeScaleY_128).to.equal(feeYScale_1);
        expect(liquidity_1.tokenOwedX).to.equal(stringAdd(feeScale2Fee(feeXScale_1, '30000'), withdrawX_1));
        expect(liquidity_1.tokenOwedY).to.equal(stringAdd(feeScale2Fee(feeYScale_1, '30000'), withdrawY_1));


        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '10000');
        console.log((await getState(pool)).currentPoint);
        console.log((await getState(pool)).liquidity);
        console.log((await getState(pool)).liquidityX);

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -2000);


        const l2y_M2000_2 = l2y('10000', -2000, '1.0001', true);
        const costY_M2000_2 = ceil(BigNumber(l2y_M2000_2).times(1000).div(997)).toFixed(0);
        console.log('costY_M2000_2: ', costY_M2000_2, l2y_M2000_2);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costY_M2000_2, -1999);
        

        const costY_M2000_M50_2 = stringAdd(l2y('10000', -2000, '1.0001', true), yInRange('30000', -1999, -50, '1.0001', true));
        const costY_M50_6000_2 = yInRange('30000', -50, 6000, '1.0001', true);
    
        const feeYScale_2 = getSum([
            feeScaleFromCost(costY_M2000_M50_2, '30000'),
            feeScaleFromCost(costY_M50_6000_2, '30000'),
            feeScaleFromCost(l2y_M2000_2, '30000')
        ]);
        const costX_0_6000_2 = xInRange('30000', 0, 6000, '1.0001', true);
        const costX_M2000_0_2 = xInRange('30000', -2000, 0, '1.0001', true);
        const feeXScale_2 = getSum([
            feeScaleFromCost(costX_0_6000_2, '30000'),
            feeScaleFromCost(costX_M2000_0_2, '30000'),
        ]);
        await pool.connect(miner1).burn(-4000, 6000, '15000');

        const withdrawX_2 = stringAdd(l2x('5000', -2000, '1.0001', false), xInRange('15000', -1999, 6000, '1.0001', false))
        const withdrawY_2 = stringAdd(
            l2y('10000', -2000, '1.0001', false),
            yInRange('15000', -4000, -2000, '1.0001', false)
        );

        const liquidity_2 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity_2.liquidity).to.equal('5000');
        expect(liquidity_2.lastFeeScaleX_128).to.equal(stringAdd(liquidity_1.lastFeeScaleX_128, feeXScale_2));
        expect(liquidity_2.lastFeeScaleY_128).to.equal(stringAdd(liquidity_1.lastFeeScaleY_128, feeYScale_2));
        expect(liquidity_2.tokenOwedX).to.equal(
            stringAdd(
                liquidity_1.tokenOwedX,
                stringAdd(feeScale2Fee(feeXScale_2, '20000'), withdrawX_2)
            )
        );
        expect(liquidity_2.tokenOwedY).to.equal(
            stringAdd(
                liquidity_1.tokenOwedY,
                stringAdd(feeScale2Fee(feeYScale_2, '20000'), withdrawY_2)
            )
        );
        console.log('test case done');
        // done()

    });
});
