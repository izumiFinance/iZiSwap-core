const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

const {getFeeCharge, getCostYFromXAt, amountAddFee, xInRange, yInRange, getPoolParts, l2x, l2y, getState, addLiquidity, checkLimOrder} = require('../funcs');
const { decryptJsonWallet } = require("@ethersproject/json-wallets");
var tokenX;
var tokenY;

const feeAmount = 100;

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

function getFeeAcquire(fee) {
    const feeCharged = getFeeCharge(fee);
    return stringMinus(fee, feeCharged);
}

function getFeeAcquireFromCost(cost) {
    const fee = getFee(cost, feeAmount);
    return getFeeAcquire(fee);
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

function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex);
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

async function getLiquidity(testMint, miner, tokenX, tokenY, fee, leftPt, rightPt) {
    const {liquidity, lastFeeScaleX_128, lastFeeScaleY_128} = await testMint.connect(miner).liquidities(tokenX.address, tokenY.address, fee, leftPt, rightPt);
    return {
        lastFeeScaleX_128: lastFeeScaleX_128.toString(),
        lastFeeScaleY_128: lastFeeScaleY_128.toString(),
    }
}

async function getDeltaFeeScale(testMint, pool, miner, leftPt, rightPt) {

    const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner, tokenX, tokenY, feeAmount, leftPt, rightPt);
    await pool.connect(miner).burn(leftPt, rightPt, 0);

    const {lastFeeScaleX_128: newScaleX, lastFeeScaleY_128: newScaleY} = await getLiquidity(testMint, miner, tokenX, tokenY, feeAmount, leftPt, rightPt);

    const q256 = BigNumber(2).pow(256).toFixed(0);

    const deltaScaleX = stringLess(newScaleX, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX, q256), lastFeeScaleX_128) : stringMinus(newScaleX, lastFeeScaleX_128);
    const deltaScaleY = stringLess(newScaleY, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY, q256), lastFeeScaleY_128) : stringMinus(newScaleY, lastFeeScaleY_128);

    return {deltaScaleX, deltaScaleY};
}

async function getAbsFeeScale(testMint, miner, leftPt, rightPt) {
    const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner, tokenX, tokenY, feeAmount, leftPt, rightPt);
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

async function addLimOrderWithY(tokenX, tokenY, seller, testAddLimOrder, amountY, point) {
    await tokenY.transfer(seller.address, amountY);
    await tokenY.connect(seller).approve(testAddLimOrder.address, amountY);
    await testAddLimOrder.connect(seller).addLimOrderWithY(
        tokenX.address, tokenY.address, feeAmount, point, amountY
    );
}
async function addLimOrderWithX(tokenX, tokenY, seller, testAddLimOrder, amountX, point) {
    await tokenX.transfer(seller.address, amountX);
    await tokenX.connect(seller).approve(testAddLimOrder.address, amountX);
    await testAddLimOrder.connect(seller).addLimOrderWithX(
        tokenX.address, tokenY.address, feeAmount, point, amountX
    );
}

async function getStatusVal(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}

async function getBitsFromPool(poolAddr, idx) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
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

async function swapY2XDesireX(testSwap, trader, tokenX, tokenY, fee, desireX, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapY2XDesireX(tokenX.address, tokenY.address, fee, desireX, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        acquireX: stringMinus(traderAmountXAfter, traderAmountXBefore),
        costY: stringMinus(traderAmountYBefore, traderAmountYAfter),
    }
}

async function swapX2Y(testSwap, trader, tokenX, tokenY, fee, costY, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, fee, costY, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        acquireX: stringMinus(traderAmountXAfter, traderAmountXBefore),
        costY: stringMinus(traderAmountYBefore, traderAmountYAfter),
    }
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
    var logPowMath;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, miner4, trader, seller1, seller2, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule);
        await factory.deployed();

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 100, 10);
        poolAddr = await factory.pool(txAddr, tyAddr, 100);

        const LogPowMathTest = await ethers.getContractFactory('TestLogPowMath');
        logPowMath = await LogPowMathTest.deploy();

        await tokenX.mint(miner1.address, '1000000000000000000000000000000');
        await tokenY.mint(miner1.address, '1000000000000000000000000000000');
        await tokenX.mint(miner2.address, '1000000000000000000000000000000');
        await tokenY.mint(miner2.address, '1000000000000000000000000000000');

        await tokenX.mint(miner3.address, '1000000000000000000000000000000');
        await tokenY.mint(miner3.address, '1000000000000000000000000000000');
        await tokenX.mint(miner4.address, '1000000000000000000000000000000');
        await tokenY.mint(miner4.address, '1000000000000000000000000000000');

        await tokenX.mint(trader.address, '1000000000000000000000000000000');
        await tokenY.mint(trader.address, '1000000000000000000000000000000');
        await tokenX.mint(seller1.address, '1000000000000000000000000000000');
        await tokenY.mint(seller1.address, '1000000000000000000000000000000');
        await tokenX.mint(seller2.address, '1000000000000000000000000000000');
        await tokenY.mint(seller2.address, '1000000000000000000000000000000');

        // test mint
        const testMintFactory = await ethers.getContractFactory("TestMint");
        testMint = await testMintFactory.deploy(factory.address);
        await testMint.deployed();

        const testSwapFactory = await ethers.getContractFactory('TestSwap');
        testSwap = await testSwapFactory.deploy(factory.address);
        await testSwap.deployed();

        const getPoolAddr = await testMint.pool(txAddr, tyAddr, 100);
        expect(getPoolAddr.toLowerCase()).to.equal(poolAddr.toLowerCase());

        const poolFactory = await ethers.getContractFactory('iZiSwapPool');
        pool = await poolFactory.attach(poolAddr);

        await tokenX.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner3).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner3).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner4).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner4).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenX.connect(seller1).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(seller1).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenX.connect(seller2).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(seller2).approve(testAddLimOrder.address, '1000000000000000000000000000000');

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

    });
    
    it("(1)", async function () {

        this.timeout(1000000);

        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 10, 11, '1000000');
        const costXAt10_0 = l2x('1000000', (await logPowMath.getSqrtPrice(10)).toString(), true)
        await swapX2Y(testSwap, trader, tokenX, tokenY, 100, amountAddFee(costXAt10_0, 100), 10)

        const state0 = await getState(pool);
        expect(state0.liquidity).to.equal('1000000')
        expect(state0.liquidityX).to.equal('1000000')
        expect(state0.currentPoint).to.equal('10')

        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 11, 12, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 12, 30, '3000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 28, 29, '1000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 30, 32, '2000000');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 99, 100, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 100, 160, '3000000');

        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 10);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 11);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 12);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 20);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 21);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 30);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 31);

        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 48);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 49);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 50);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 51);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 52);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 53);

        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 101);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 148);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 149);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 150);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 151);

        // swap1

        const costYAt10 = l2y('1000000', (await logPowMath.getSqrtPrice(10)).toString(), true)
        const acquireXAt10 = l2x('1000000', (await logPowMath.getSqrtPrice(10)).toString(), false)
        const costYAt10_WithFee = amountAddFee(costYAt10, 100);

        const acquireLimXAt11 = '100000000000000000000';
        const costLimYAt11 = getCostYFromXAt((await logPowMath.getSqrtPrice(11)).toString(), acquireLimXAt11);
        const costLimYAt11_WithFee = amountAddFee(costLimYAt11, 100);

        const costYAt11_1 = l2y('500000', (await logPowMath.getSqrtPrice(11)).toString(), true);
        const acquireXAt11_1 = l2x('500000', (await logPowMath.getSqrtPrice(11)).toString(), false);
        const costYAt11_WithFee_1 = amountAddFee(costYAt11_1, 100);

        const swap1 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireXAt10, acquireLimXAt11, acquireXAt11_1]), 10000)

        expect(swap1.acquireX).to.equal(getSum([acquireXAt10, acquireLimXAt11, acquireXAt11_1]))
        expect(swap1.costY).to.equal(getSum([costYAt10_WithFee, costLimYAt11_WithFee, costYAt11_WithFee_1]))

        const state1 = await getState(pool);
        expect(state1.liquidity).to.equal('2000000')
        expect(state1.liquidityX).to.equal('1500000')
        expect(state1.currentPoint).to.equal('11')

        // swap2

        const costYAt11_2 = l2y('1500000', (await logPowMath.getSqrtPrice(11)).toString(), true);
        const acquireXAt11_2 = l2x('1500000', (await logPowMath.getSqrtPrice(11)).toString(), false);
        const costYAt11_WithFee_2 = amountAddFee(costYAt11_2, 100);

        const acquireLimXAt12_2 = '80000000000000000000';
        const costLimYAt12_2 = getCostYFromXAt((await logPowMath.getSqrtPrice(12)).toString(), acquireLimXAt12_2);
        const costLimYAt12_WithFee_2 = amountAddFee(costLimYAt12_2, 100);

        const swap2 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireXAt11_2, acquireLimXAt12_2]), 1000)

        expect(swap2.acquireX).to.equal(getSum([acquireXAt11_2, acquireLimXAt12_2]))
        expect(swap2.costY).to.equal(getSum([costYAt11_WithFee_2, costLimYAt12_WithFee_2]))

        const state2 = await getState(pool);
        expect(state2.liquidity).to.equal('3000000')
        expect(state2.liquidityX).to.equal('3000000')
        expect(state2.currentPoint).to.equal('12')

        // swap3

        const acquireLimXAt12_3 = '20000000000000000000';
        const costLimYAt12_3 = getCostYFromXAt((await logPowMath.getSqrtPrice(12)).toString(), acquireLimXAt12_3);
        const costLimYAt12_WithFee_3 = amountAddFee(costLimYAt12_3, 100);

        const costY_12_16 = yInRange('3000000', 12, 16, '1.0001', true);
        const acquireX_12_16 = xInRange('3000000', 12, 16, '1.0001', false);
        const costY_12_16_WithFee = amountAddFee(costY_12_16, 100);

        const costYAt16_3 = l2y('800000', (await logPowMath.getSqrtPrice(16)).toString(), true)
        const acquireXAt16_3 = l2x('800000', (await logPowMath.getSqrtPrice(16)).toString(), false)
        const costYAt16_WithFee_3 = amountAddFee(costYAt16_3, 100);

        const swap3 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireLimXAt12_3, acquireX_12_16, acquireXAt16_3]), 1000)
        expect(swap3.acquireX).to.equal(getSum([acquireLimXAt12_3, acquireX_12_16, acquireXAt16_3]))
        expect(swap3.costY).to.equal(getSum([costLimYAt12_WithFee_3, costY_12_16_WithFee, costYAt16_WithFee_3]))

        const state3 = await getState(pool);
        expect(state3.liquidity).to.equal('3000000')
        expect(state3.liquidityX).to.equal('2200000')
        expect(state3.currentPoint).to.equal('16')

        // swap4
        const costYAt16_4 = l2y('2200000', (await logPowMath.getSqrtPrice(16)).toString(), true)
        const acquireXAt16_4 = l2x('2200000', (await logPowMath.getSqrtPrice(16)).toString(), false)
        const costYAt16_WithFee_4 = amountAddFee(costYAt16_4, 100);

        const costY_17_20 = yInRange('3000000', 17, 20, '1.0001', true);
        const acquireX_17_20 = xInRange('3000000', 17, 20, '1.0001', false);
        const costY_17_20_WithFee = amountAddFee(costY_17_20, 100);

        const acquireLimXAt20_4 = '20000000000000000000';
        const costLimYAt20_4 = getCostYFromXAt((await logPowMath.getSqrtPrice(20)).toString(), acquireLimXAt20_4);
        const costLimYAt20_WithFee_4 = amountAddFee(costLimYAt20_4, 100);

        const swap4 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireXAt16_4, acquireX_17_20, acquireLimXAt20_4]), 1000)
        expect(swap4.acquireX).to.equal(getSum([acquireXAt16_4, acquireX_17_20, acquireLimXAt20_4]))
        expect(swap4.costY).to.equal(getSum([costYAt16_WithFee_4, costY_17_20_WithFee, costLimYAt20_WithFee_4]))

        const state4 = await getState(pool);
        expect(state4.liquidity).to.equal('3000000')
        expect(state4.liquidityX).to.equal('3000000')
        expect(state4.currentPoint).to.equal('20')

        // swap5

        const acquireLimXAt20_5 = '80000000000000000000';
        const costLimYAt20_5 = getCostYFromXAt((await logPowMath.getSqrtPrice(20)).toString(), acquireLimXAt20_5);
        const costLimYAt20_WithFee_5 = amountAddFee(costLimYAt20_5, 100);

        const costYAt20 = l2y('3000000', (await logPowMath.getSqrtPrice(20)).toString(), true)
        const acquireXAt20 = l2x('3000000', (await logPowMath.getSqrtPrice(20)).toString(), false)
        const costYAt20_WithFee = amountAddFee(costYAt20, 100)

        const acquireLimXAt21_5 = '100000000000000000000';
        const costLimYAt21_5 = getCostYFromXAt((await logPowMath.getSqrtPrice(21)).toString(), acquireLimXAt21_5);
        const costLimYAt21_WithFee_5 = amountAddFee(costLimYAt21_5, 100);

        const costY_21_26 = yInRange('3000000', 21, 26, '1.0001', true);
        const acquireX_21_26 = xInRange('3000000', 21, 26, '1.0001', false);

        const costYAt26_5 = l2y('200000', (await logPowMath.getSqrtPrice(26)).toString(), true)
        const acquireXAt26_5 = l2x('200000', (await logPowMath.getSqrtPrice(26)).toString(), false)
        const costY_21_26_WithFee_5 = amountAddFee(getSum([costY_21_26, costYAt26_5]), 100);

        const swap5 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireLimXAt20_5, acquireXAt20, acquireLimXAt21_5, acquireX_21_26, acquireXAt26_5]), 1000)
        expect(swap5.acquireX).to.equal(getSum([acquireLimXAt20_5, acquireXAt20, acquireLimXAt21_5, acquireX_21_26, acquireXAt26_5]))
        expect(swap5.costY).to.equal(getSum([costLimYAt20_WithFee_5, costYAt20_WithFee, costLimYAt21_WithFee_5, costY_21_26_WithFee_5]))

        const state5 = await getState(pool);
        expect(state5.liquidity).to.equal('3000000')
        expect(state5.liquidityX).to.equal('2800000')
        expect(state5.currentPoint).to.equal('26')

        // swap6

        const costYAt26_6 = l2y('800000', (await logPowMath.getSqrtPrice(26)).toString(), true)
        const acquireXAt26_6 = l2x('800000', (await logPowMath.getSqrtPrice(26)).toString(), false)
        const costYAt26_WithFee_6 = amountAddFee(costYAt26_6, 100);
        const swap6 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, acquireXAt26_6, 1000)
        expect(swap6.acquireX).to.equal(acquireXAt26_6)
        expect(swap6.costY).to.equal(costYAt26_WithFee_6)
        const state6 = await getState(pool);
        expect(state6.liquidity).to.equal('3000000')
        expect(state6.liquidityX).to.equal('2000000')
        expect(state6.currentPoint).to.equal('26')

        // swap7
        const costYAt26_7 = l2y('2000000', (await logPowMath.getSqrtPrice(26)).toString(), true)
        const acquireXAt26_7 = l2x('2000000', (await logPowMath.getSqrtPrice(26)).toString(), false)

        const costY_27_28 = yInRange('3000000', 27, 28, '1.0001', true);
        const acquireX_27_28 = xInRange('3000000', 27, 28, '1.0001', false);
        const costY_26_28_WithFee_7 = amountAddFee(getSum([costYAt26_7, costY_27_28]), 100);

        const costYAt28_7 = l2y('1500000', (await logPowMath.getSqrtPrice(28)).toString(), true)
        const acquireXAt28_7 = l2x('1500000', (await logPowMath.getSqrtPrice(28)).toString(), false)
        const costYAt28_WithFee_7 = amountAddFee(costYAt28_7, 100)

        const swap7 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireXAt26_7, acquireX_27_28, acquireXAt28_7]), 1000)
        expect(swap7.acquireX).to.equal(getSum([acquireXAt26_7, acquireX_27_28, acquireXAt28_7]))
        expect(swap7.costY).to.equal(getSum([costY_26_28_WithFee_7, costYAt28_WithFee_7]))

        // swap8
        const costYAt28_8 = l2y('2500000', (await logPowMath.getSqrtPrice(28)).toString(), true)
        const acquireXAt28_8 = l2x('2500000', (await logPowMath.getSqrtPrice(28)).toString(), false)
        const costYAt28_WithFee_8 = amountAddFee(costYAt28_8, 100)

        const costYAt29_8 = l2y('1200000', (await logPowMath.getSqrtPrice(29)).toString(), true)
        const acquireXAt29_8 = l2x('1200000', (await logPowMath.getSqrtPrice(29)).toString(), false)
        const costYAt29_WithFee_8 = amountAddFee(costYAt29_8, 100)

        const swap8 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireXAt28_8, acquireXAt29_8]), 1000)
        expect(swap8.acquireX).to.equal(getSum([acquireXAt28_8, acquireXAt29_8]))
        expect(swap8.costY).to.equal(getSum([costYAt28_WithFee_8, costYAt29_WithFee_8]))
        const state8 = await getState(pool);
        expect(state8.liquidity).to.equal('3000000')
        expect(state8.liquidityX).to.equal('1800000')
        expect(state8.currentPoint).to.equal('29')

        // swap9
        const costYAt29_9 = l2y('1800000', (await logPowMath.getSqrtPrice(29)).toString(), true)
        const acquireXAt29_9 = l2x('1800000', (await logPowMath.getSqrtPrice(29)).toString(), false)
        const costYAt29_WithFee_9 = amountAddFee(costYAt29_9, 100)

        const acquireLimXAt30_9 = '30000000000000000000';
        const costLimYAt30_9 = getCostYFromXAt((await logPowMath.getSqrtPrice(30)).toString(), acquireLimXAt30_9);
        const costLimYAt30_WithFee_9 = amountAddFee(costLimYAt30_9, 100);

        const swap9 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireXAt29_9, acquireLimXAt30_9]), 1000)
        expect(swap9.acquireX).to.equal(getSum([acquireXAt29_9, acquireLimXAt30_9]))
        expect(swap9.costY).to.equal(getSum([costYAt29_WithFee_9, costLimYAt30_WithFee_9]))
        const state9 = await getState(pool);
        expect(state9.liquidity).to.equal('2000000')
        expect(state9.liquidityX).to.equal('2000000')
        expect(state9.currentPoint).to.equal('30')

        // swap10
        const acquireLimXAt30_10 = '70000000000000000000';
        const costLimYAt30_10 = getCostYFromXAt((await logPowMath.getSqrtPrice(30)).toString(), acquireLimXAt30_10);
        const costLimYAt30_WithFee_10 = amountAddFee(costLimYAt30_10, 100);

        const costYAt30_10 = l2y('2000000', (await logPowMath.getSqrtPrice(30)).toString(), true)
        const acquireXAt30_10 = l2x('2000000', (await logPowMath.getSqrtPrice(30)).toString(), false)
        const costYAt30_WithFee_10 = amountAddFee(costYAt30_10, 100)

        const acquireLimXAt31_10 = '100000000000000000000';
        const costLimYAt31_10 = getCostYFromXAt((await logPowMath.getSqrtPrice(31)).toString(), acquireLimXAt31_10);
        const costLimYAt31_WithFee_10 = amountAddFee(costLimYAt31_10, 100);

        const costYAt31_10 = l2y('2000000', (await logPowMath.getSqrtPrice(31)).toString(), true)
        const acquireXAt31_10 = l2x('2000000', (await logPowMath.getSqrtPrice(31)).toString(), false)
        const costYAt31_WithFee_10 = amountAddFee(costYAt31_10, 100)

        const acquireLimXAt48_10 = '80000000000000000000';
        const costLimYAt48_10 = getCostYFromXAt((await logPowMath.getSqrtPrice(48)).toString(), acquireLimXAt48_10);
        const costLimYAt48_WithFee_10 = amountAddFee(costLimYAt48_10, 100);
        const swap10 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, 
            getSum([
                acquireLimXAt30_10, 
                acquireXAt30_10, 
                acquireLimXAt31_10, 
                acquireXAt31_10, 
                acquireLimXAt48_10
        ]), 1000)
        
        expect(swap10.acquireX).to.equal(getSum([
            acquireLimXAt30_10, 
            acquireXAt30_10, 
            acquireLimXAt31_10, 
            acquireXAt31_10, 
            acquireLimXAt48_10
        ]))
        expect(swap10.costY).to.equal(getSum([
            costLimYAt30_WithFee_10, 
            costYAt30_WithFee_10, 
            costLimYAt31_WithFee_10, 
            costYAt31_WithFee_10, 
            costLimYAt48_WithFee_10
        ]))
        const state10 = await getState(pool);
        expect(state10.liquidity).to.equal('0')
        expect(state10.liquidityX).to.equal('0')
        expect(state10.currentPoint).to.equal('48')

        await checkLimOrder('20000000000000000000', '0', '0', costLimYAt48_10, '0', costLimYAt48_10, poolAddr, 48)

        // swap11
        const acquireLimXAt48_11 = '20000000000000000000';
        const costLimYAt48_11 = getCostYFromXAt((await logPowMath.getSqrtPrice(48)).toString(), acquireLimXAt48_11);
        const costLimYAt48_WithFee_11 = amountAddFee(costLimYAt48_11, 100);
        const acquireLimXAt49_11 = '100000000000000000000';
        const costLimYAt49_11 = getCostYFromXAt((await logPowMath.getSqrtPrice(49)).toString(), acquireLimXAt49_11);
        const costLimYAt49_WithFee_11 = amountAddFee(costLimYAt49_11, 100);
        const acquireLimXAt50_11 = '100000000000000000000';
        const costLimYAt50_11 = getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), acquireLimXAt50_11);
        const costLimYAt50_WithFee_11 = amountAddFee(costLimYAt50_11, 100);
        const swap11 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, 
            getSum([
                acquireLimXAt48_11, acquireLimXAt49_11, acquireLimXAt50_11
        ]), 1000)
        
        expect(swap11.acquireX).to.equal(getSum([
            acquireLimXAt48_11, acquireLimXAt49_11, acquireLimXAt50_11
        ]))
        expect(swap11.costY).to.equal(getSum([
            costLimYAt48_WithFee_11, costLimYAt49_WithFee_11, costLimYAt50_WithFee_11
        ]))
        const state11 = await getState(pool);
        expect(state11.liquidity).to.equal('0')
        expect(state11.liquidityX).to.equal('0')
        expect(state11.currentPoint).to.equal('50')

        await checkLimOrder('0', '0', '0', costLimYAt50_11, '0', costLimYAt50_11, poolAddr, 50)

        // swap12
        const acquireLimXAt51_12 = '80000000000000000000';
        const costLimYAt51_12 = getCostYFromXAt((await logPowMath.getSqrtPrice(51)).toString(), acquireLimXAt51_12);
        const costLimYAt51_WithFee_12 = amountAddFee(costLimYAt51_12, 100);

        const swap12 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, 
            getSum([acquireLimXAt51_12
        ]), 1000)
        
        expect(swap12.acquireX).to.equal(getSum([acquireLimXAt51_12
        ]))
        expect(swap12.costY).to.equal(getSum([costLimYAt51_WithFee_12
        ]))
        const state12 = await getState(pool);
        expect(state12.liquidity).to.equal('0')
        expect(state12.liquidityX).to.equal('0')
        expect(state12.currentPoint).to.equal('51')

        await checkLimOrder('20000000000000000000', '0', '0', costLimYAt51_12, '0', costLimYAt51_12, poolAddr, '51')

        // swap13
        const acquireLimXAt51_13 = '20000000000000000000';
        const costLimYAt51_13 = getCostYFromXAt((await logPowMath.getSqrtPrice(51)).toString(), acquireLimXAt51_13);
        const costLimYAt51_WithFee_13 = amountAddFee(costLimYAt51_13, 100);

        const acquireLimXAt52_13 = '100000000000000000000';
        const costLimYAt52_13 = getCostYFromXAt((await logPowMath.getSqrtPrice(52)).toString(), acquireLimXAt52_13);
        const costLimYAt52_WithFee_13 = amountAddFee(costLimYAt52_13, 100);

        const acquireLimXAt53_13 = '100000000000000000000';
        const costLimYAt53_13 = getCostYFromXAt((await logPowMath.getSqrtPrice(53)).toString(), acquireLimXAt53_13);
        const costLimYAt53_WithFee_13 = amountAddFee(costLimYAt53_13, 100);

        const costYAt99_13 = l2y('1000000', (await logPowMath.getSqrtPrice(99)).toString(), true)
        const acquireXAt99_13 = l2x('1000000', (await logPowMath.getSqrtPrice(99)).toString(), false)
        const costYAt99_WithFee_13 = amountAddFee(costYAt99_13, 100)
        const swap13 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, 
            getSum([acquireLimXAt51_13, acquireLimXAt52_13, acquireLimXAt53_13, acquireXAt99_13
        ]), 1000)

        expect(swap13.acquireX).to.equal(getSum([acquireLimXAt51_13, acquireLimXAt52_13, acquireLimXAt53_13, acquireXAt99_13
        ]))
        expect(swap13.costY).to.equal(getSum([costLimYAt51_WithFee_13, costLimYAt52_WithFee_13, costLimYAt53_WithFee_13, costYAt99_WithFee_13
        ]))
        const state13 = await getState(pool);
        expect(state13.liquidity).to.equal('2000000')
        expect(state13.liquidityX).to.equal('1000000')
        expect(state13.currentPoint).to.equal('99')

        // swap14
        const costYAt99_14 = l2y('1000000', (await logPowMath.getSqrtPrice(99)).toString(), true)
        const acquireXAt99_14 = l2x('1000000', (await logPowMath.getSqrtPrice(99)).toString(), false)
        const costYAt99_WithFee_14 = amountAddFee(costYAt99_14, 100)
        const costYAt100_14 = l2y('3000000', (await logPowMath.getSqrtPrice(100)).toString(), true)
        const acquireXAt100_14 = l2x('3000000', (await logPowMath.getSqrtPrice(100)).toString(), false)
        const costYAt100_WithFee_14 = amountAddFee(costYAt100_14, 100)
        const acquireLimXAt101_14 = '100000000000000000000';
        const costLimYAt101_14 = getCostYFromXAt((await logPowMath.getSqrtPrice(101)).toString(), acquireLimXAt101_14);
        const costLimYAt101_WithFee_14 = amountAddFee(costLimYAt101_14, 100);

        const costY_101_148 = yInRange('3000000', 101, 148, '1.0001', true);
        const acquireX_101_148 = xInRange('3000000', 101, 148, '1.0001', false);
        const costY_101_148_WithFee = amountAddFee(costY_101_148, 100);
        const acquireLimXAt148_14 = '30000000000000000000';
        const costLimYAt148_14 = getCostYFromXAt((await logPowMath.getSqrtPrice(148)).toString(), acquireLimXAt148_14);
        const costLimYAt148_WithFee_14 = amountAddFee(costLimYAt148_14, 100);

        const swap14 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, 
            getSum([acquireXAt99_14, acquireXAt100_14, acquireLimXAt101_14, acquireX_101_148, acquireLimXAt148_14
        ]), 1000)

        expect(swap14.acquireX).to.equal(getSum([
            acquireXAt99_14, acquireXAt100_14, acquireLimXAt101_14, acquireX_101_148, acquireLimXAt148_14
        ]))
        expect(swap14.costY).to.equal(getSum([
            costYAt99_WithFee_14, costYAt100_WithFee_14, costLimYAt101_WithFee_14, costY_101_148_WithFee, costLimYAt148_WithFee_14
        ]))
        const state14 = await getState(pool);
        expect(state14.liquidity).to.equal('3000000')
        expect(state14.liquidityX).to.equal('3000000')
        expect(state14.currentPoint).to.equal('148')
        await checkLimOrder('70000000000000000000', '0', '0', costLimYAt148_14, '0', costLimYAt148_14, poolAddr, '148')
    });

    it("(2)", async function () {

        this.timeout(1000000);

        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 10, 11, '1000000');
        const costXAt10_0 = l2x('1000000', (await logPowMath.getSqrtPrice(10)).toString(), true)
        await swapX2Y(testSwap, trader, tokenX, tokenY, 100, amountAddFee(costXAt10_0, 100), 10)

        const state0 = await getState(pool);
        expect(state0.liquidity).to.equal('1000000')
        expect(state0.liquidityX).to.equal('1000000')
        expect(state0.currentPoint).to.equal('10')

        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 11, 12, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 12, 13, '3000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 13, 14, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 14, 15, '1000000');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, 50, 51, '1000000');
        
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', 13);
        
        // swap1

        const costYAt10_1 = l2y('200000', (await logPowMath.getSqrtPrice(10)).toString(), true)
        const acquireXAt10_1 = l2x('200000', (await logPowMath.getSqrtPrice(10)).toString(), false)
        const costYAt10_WithFee_1 = amountAddFee(costYAt10_1, 100);

        // const acquireLimXAt11 = '100000000000000000000';
        // const costLimYAt11 = getCostYFromXAt((await logPowMath.getSqrtPrice(11)).toString(), acquireLimXAt11);
        // const costLimYAt11_WithFee = amountAddFee(costLimYAt11, 100);

        // const costYAt11_1 = l2y('500000', (await logPowMath.getSqrtPrice(11)).toString(), true);
        // const acquireXAt11_1 = l2x('500000', (await logPowMath.getSqrtPrice(11)).toString(), false);
        // const costYAt11_WithFee_1 = amountAddFee(costYAt11_1, 100);

        const swap1 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([acquireXAt10_1]), 10000)

        expect(swap1.acquireX).to.equal(getSum([acquireXAt10_1]))
        expect(swap1.costY).to.equal(getSum([costYAt10_WithFee_1]))

        const state1 = await getState(pool);
        expect(state1.liquidity).to.equal('1000000')
        expect(state1.liquidityX).to.equal('800000')
        expect(state1.currentPoint).to.equal('10')

        // swap2
        const costYAt10_2 = l2y('800000', (await logPowMath.getSqrtPrice(10)).toString(), true)
        const acquireXAt10_2 = l2x('800000', (await logPowMath.getSqrtPrice(10)).toString(), false)
        const costYAt10_WithFee_2 = amountAddFee(costYAt10_2, 100);

        const costYAt11_2 = l2y('2000000', (await logPowMath.getSqrtPrice(11)).toString(), true)
        const acquireXAt11_2 = l2x('2000000', (await logPowMath.getSqrtPrice(11)).toString(), false)
        const costYAt11_WithFee_2 = amountAddFee(costYAt11_2, 100);

        const costYAt12_2 = l2y('3000000', (await logPowMath.getSqrtPrice(12)).toString(), true)
        const acquireXAt12_2 = l2x('3000000', (await logPowMath.getSqrtPrice(12)).toString(), false)
        const costYAt12_WithFee_2 = amountAddFee(costYAt12_2, 100);

        const acquireLimXAt13_2 = '100000000000000000000';
        const costLimYAt13_2 = getCostYFromXAt((await logPowMath.getSqrtPrice(13)).toString(), acquireLimXAt13_2);
        const costLimYAt13_WithFee_2 = amountAddFee(costLimYAt13_2, 100);

        const costYAt13_2 = l2y('2000000', (await logPowMath.getSqrtPrice(13)).toString(), true)
        const acquireXAt13_2 = l2x('2000000', (await logPowMath.getSqrtPrice(13)).toString(), false)
        const costYAt13_WithFee_2 = amountAddFee(costYAt13_2, 100);


        const costYAt14_2 = l2y('1000000', (await logPowMath.getSqrtPrice(14)).toString(), true)
        const acquireXAt14_2 = l2x('1000000', (await logPowMath.getSqrtPrice(14)).toString(), false)
        const costYAt14_WithFee_2 = amountAddFee(costYAt14_2, 100);

        const costYAt50_2 = l2y('800000', (await logPowMath.getSqrtPrice(50)).toString(), true)
        const acquireXAt50_2 = l2x('800000', (await logPowMath.getSqrtPrice(50)).toString(), false)
        const costYAt50_WithFee_2 = amountAddFee(costYAt50_2, 100);


        const swap2 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireXAt10_2, acquireXAt11_2, acquireXAt12_2, acquireLimXAt13_2, acquireXAt13_2,
            acquireXAt14_2, acquireXAt50_2
        ]), 10000)

        expect(swap2.acquireX).to.equal(getSum([
            acquireXAt10_2, acquireXAt11_2, acquireXAt12_2, acquireLimXAt13_2, acquireXAt13_2,
            acquireXAt14_2, acquireXAt50_2
        ]))
        expect(swap2.costY).to.equal(getSum([
            costYAt10_WithFee_2, costYAt11_WithFee_2, costYAt12_WithFee_2, costLimYAt13_WithFee_2, costYAt13_WithFee_2,
            costYAt14_WithFee_2, costYAt50_WithFee_2
        ]))

        const state2 = await getState(pool);
        expect(state2.liquidity).to.equal('1000000')
        expect(state2.liquidityX).to.equal('200000')
        expect(state2.currentPoint).to.equal('50')
    });
});