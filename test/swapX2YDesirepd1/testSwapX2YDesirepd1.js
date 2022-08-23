const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

const {getFeeCharge, getCostXFromYAt, amountAddFee, xInRange, yInRange, getPoolParts, l2x, l2y, getState, addLiquidity, checkLimOrder} = require('../funcs');
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

async function swapX2YDesireY(testSwap, trader, tokenX, tokenY, fee, desireY, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2YDesireY(tokenX.address, tokenY.address, fee, desireY, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        costX: stringMinus(traderAmountXBefore, traderAmountXAfter),
        acquireY: stringMinus(traderAmountYAfter, traderAmountYBefore),
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

        await factory.newPool(txAddr, tyAddr, 100, 0);
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
        
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -1000, -500, '1000000');

        for (let pt = -900; pt <= -896; pt ++) {
            await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', pt); 
        }

        for (let pt = -601; pt <= -598; pt ++) {
            await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', pt); 
        }

        for (let pt = -200; pt <= -195; pt ++) {
            await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', pt); 
        }


        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -150, -149, '1000000');
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', -149);
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -149, -148, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -148, -140, '3000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -140, -139, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -139, -138, '1000000');

        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', -51);
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -51, -50, '1000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -50, -49, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -49, -48, '3000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -48, -47, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 100, -47, -46, '1000000');
        
        // swap1

        const costXAtM47 = l2x('700000', (await logPowMath.getSqrtPrice(-47)).toString(), true)
        const acquireYAtM47 = l2y('700000', (await logPowMath.getSqrtPrice(-47)).toString(), false)
        const costXAtM47_WithFee = amountAddFee(costXAtM47, 100);

        const swap1 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([acquireYAtM47]), -10000)

        expect(swap1.acquireY).to.equal(getSum([acquireYAtM47]))
        expect(swap1.costX).to.equal(getSum([costXAtM47_WithFee]))

        const state1 = await getState(pool);
        expect(state1.liquidity).to.equal('1000000')
        expect(state1.liquidityX).to.equal('700000')
        expect(state1.currentPoint).to.equal('-47')

        // swap2

        const costXAtM47_2 = l2x('300000', (await logPowMath.getSqrtPrice(-47)).toString(), true)
        const acquireYAtM47_2 = l2y('300000', (await logPowMath.getSqrtPrice(-47)).toString(), false)
        const costXAtM47_WithFee_2 = amountAddFee(costXAtM47_2, 100);

        const costXAtM48_2 = l2x('2000000', (await logPowMath.getSqrtPrice(-48)).toString(), true)
        const acquireYAtM48_2 = l2y('2000000', (await logPowMath.getSqrtPrice(-48)).toString(), false)
        const costXAtM48_WithFee = amountAddFee(costXAtM48_2, 100);

        const costXAtM49_2 = l2x('1000000', (await logPowMath.getSqrtPrice(-49)).toString(), true)
        const acquireYAtM49_2 = l2y('1000000', (await logPowMath.getSqrtPrice(-49)).toString(), false)
        const costXAtM49_WithFee = amountAddFee(costXAtM49_2, 100);

        const swap2 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([acquireYAtM47_2, acquireYAtM48_2, acquireYAtM49_2]), -10000)

        expect(swap2.acquireY).to.equal(getSum([acquireYAtM47_2, acquireYAtM48_2, acquireYAtM49_2]))
        expect(swap2.costX).to.equal(getSum([costXAtM47_WithFee_2, costXAtM48_WithFee, costXAtM49_WithFee]))

        const state2 = await getState(pool);
        expect(state2.liquidity).to.equal('3000000')
        expect(state2.liquidityX).to.equal('1000000')
        expect(state2.currentPoint).to.equal('-49')



        // swap3

        const costXAtM49_3 = l2x('1000000', (await logPowMath.getSqrtPrice(-49)).toString(), true)
        const acquireYAtM49_3 = l2y('1000000', (await logPowMath.getSqrtPrice(-49)).toString(), false)
        const costXAtM49_WithFee_3 = amountAddFee(costXAtM49_3, 100);
        const swap3 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([acquireYAtM49_3]), -10000)

        expect(swap3.acquireY).to.equal(getSum([acquireYAtM49_3]))
        expect(swap3.costX).to.equal(getSum([costXAtM49_WithFee_3]))

        const state3 = await getState(pool);
        expect(state3.liquidity).to.equal('3000000')
        expect(state3.liquidityX).to.equal('2000000')
        expect(state3.currentPoint).to.equal('-49')

        // swap4
        const costXAtM49_4 = l2x('1000000', (await logPowMath.getSqrtPrice(-49)).toString(), true)
        const acquireYAtM49_4 = l2y('1000000', (await logPowMath.getSqrtPrice(-49)).toString(), false)
        const costXAtM49_WithFee_4 = amountAddFee(costXAtM49_4, 100);

        const costXAtM50_4 = l2x('2000000', (await logPowMath.getSqrtPrice(-50)).toString(), true)
        const acquireYAtM50_4 = l2y('2000000', (await logPowMath.getSqrtPrice(-50)).toString(), false)
        const costXAtM50_WithFee_4 = amountAddFee(costXAtM50_4, 100);
        
        const costXAtM51_4 = l2x('1000000', (await logPowMath.getSqrtPrice(-51)).toString(), true)
        const acquireYAtM51_4 = l2y('1000000', (await logPowMath.getSqrtPrice(-51)).toString(), false)
        const costXAtM51_WithFee_4 = amountAddFee(costXAtM51_4, 100);

        const acquireLimYAtM51_4 = '100000000000000000000';
        const costLimXAtM51_4 = getCostXFromYAt((await logPowMath.getSqrtPrice(-51)).toString(), acquireLimYAtM51_4);
        const costLimXAtM51_WithFee_4 = amountAddFee(costLimXAtM51_4, 100);

        const costXAtM139_4 = l2x('1000000', (await logPowMath.getSqrtPrice(-139)).toString(), true)
        const acquireYAtM139_4 = l2y('1000000', (await logPowMath.getSqrtPrice(-139)).toString(), false)
        const costXAtM139_WithFee_4 = amountAddFee(costXAtM139_4, 100);

        const costXAtM140_4 = l2x('1000000', (await logPowMath.getSqrtPrice(-140)).toString(), true)
        const acquireYAtM140_4 = l2y('1000000', (await logPowMath.getSqrtPrice(-140)).toString(), false)
        const costXAtM140_WithFee_4 = amountAddFee(costXAtM140_4, 100);
        const swap4 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireYAtM49_4, acquireYAtM50_4, acquireYAtM51_4, acquireLimYAtM51_4, acquireYAtM139_4, acquireYAtM140_4
        ]), -10000)

        const state4 = await getState(pool);
        expect(state4.liquidity).to.equal('2000000')
        expect(state4.liquidityX).to.equal('1000000')
        expect(state4.currentPoint).to.equal('-140')

        expect(swap4.acquireY).to.equal(getSum([
            acquireYAtM49_4, acquireYAtM50_4, acquireYAtM51_4, acquireLimYAtM51_4, acquireYAtM139_4, acquireYAtM140_4
        ]))
        expect(swap4.costX).to.equal(getSum([
            costXAtM49_WithFee_4, costXAtM50_WithFee_4, costXAtM51_WithFee_4, costLimXAtM51_WithFee_4,
            costXAtM139_WithFee_4, costXAtM140_WithFee_4
        ]))

        // swap5

        const costXAtM140_5 = l2x('1000000', (await logPowMath.getSqrtPrice(-140)).toString(), true)
        const acquireYAtM140_5 = l2y('1000000', (await logPowMath.getSqrtPrice(-140)).toString(), false)
        const costXAtM140_WithFee_5 = amountAddFee(costXAtM140_5, 100)

        const costX_M145_M140 = xInRange('3000000', -145, -140, '1.0001', true)
        const acquireY_M145_M140 = yInRange('3000000', -145, -140, '1.0001', false)
        const costX_M145_M140_WithFee = amountAddFee(costX_M145_M140, 100)

        const costXAtM146_5 = l2x('1000000', (await logPowMath.getSqrtPrice(-146)).toString(), true)
        const acquireYAtM146_5 = l2y('1000000', (await logPowMath.getSqrtPrice(-146)).toString(), false)
        const costXAtM146_WithFee_5 = amountAddFee(costXAtM146_5, 100);

        const swap5 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireYAtM140_5, acquireY_M145_M140, acquireYAtM146_5
        ]), -10000)

        const state5 = await getState(pool);
        expect(state5.liquidity).to.equal('3000000')
        expect(state5.liquidityX).to.equal('1000000')
        expect(state5.currentPoint).to.equal('-146')

        expect(swap5.acquireY).to.equal(getSum([
            acquireYAtM140_5, acquireY_M145_M140, acquireYAtM146_5
        ]))
        expect(swap5.costX).to.equal(getSum([
            costXAtM140_WithFee_5, costX_M145_M140_WithFee, costXAtM146_WithFee_5
        ]))

        // swap6

        const costXAtM146_6 = l2x('1000000', (await logPowMath.getSqrtPrice(-146)).toString(), true)
        const acquireYAtM146_6 = l2y('1000000', (await logPowMath.getSqrtPrice(-146)).toString(), false)
        const costXAtM146_WithFee_6 = amountAddFee(costXAtM146_6, 100);

        const swap6 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireYAtM146_6
        ]), -10000)

        const state6 = await getState(pool);
        expect(state6.liquidity).to.equal('3000000')
        expect(state6.liquidityX).to.equal('2000000')
        expect(state6.currentPoint).to.equal('-146')

        expect(swap6.acquireY).to.equal(getSum([
            acquireYAtM146_6
        ]))
        expect(swap6.costX).to.equal(getSum([
            costXAtM146_WithFee_6
        ]))

        // swap7
        const costXAtM146_7 = l2x('1000000', (await logPowMath.getSqrtPrice(-146)).toString(), true)
        const acquireYAtM146_7 = l2y('1000000', (await logPowMath.getSqrtPrice(-146)).toString(), false)
        const costXAtM146_WithFee_7 = amountAddFee(costXAtM146_7, 100);

        const costX_M148_M146 = xInRange('3000000', -148, -146, '1.0001', true)
        const acquireY_M148_M146 = yInRange('3000000', -148, -146, '1.0001', false)
        const costX_M148_M146_WithFee = amountAddFee(costX_M148_M146, 100)

        const costXAtM149_7 = l2x('2000000', (await logPowMath.getSqrtPrice(-149)).toString(), true)
        const acquireYAtM149_7 = l2y('2000000', (await logPowMath.getSqrtPrice(-149)).toString(), false)
        const costXAtM149_WithFee_7 = amountAddFee(costXAtM149_7, 100);

        const acquireLimYAtM149_7 = '30000000000000000000';
        const costLimXAtM149_7 = getCostXFromYAt((await logPowMath.getSqrtPrice(-149)).toString(), acquireLimYAtM149_7);
        const costLimXAtM149_WithFee_7 = amountAddFee(costLimXAtM149_7, 100);


        const swap7 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireYAtM146_7, acquireY_M148_M146, acquireYAtM149_7, acquireLimYAtM149_7
        ]), -10000)

        expect(swap7.acquireY).to.equal(getSum([
            acquireYAtM146_7, acquireY_M148_M146, acquireYAtM149_7, acquireLimYAtM149_7
        ]))
        expect(swap7.costX).to.equal(getSum([
            costXAtM146_WithFee_7, costX_M148_M146_WithFee, costXAtM149_WithFee_7, costLimXAtM149_WithFee_7
        ]))

        const state7 = await getState(pool);
        expect(state7.liquidity).to.equal('2000000')
        expect(state7.liquidityX).to.equal('2000000')
        expect(state7.currentPoint).to.equal('-149')

        // swap8

        const acquireLimYAtM149_8 = '70000000000000000000';
        const costLimXAtM149_8 = getCostXFromYAt((await logPowMath.getSqrtPrice(-149)).toString(), acquireLimYAtM149_8);
        const costLimXAtM149_WithFee_8 = amountAddFee(costLimXAtM149_8, 100);

        const costXAtM150_8 = l2x('1000000', (await logPowMath.getSqrtPrice(-150)).toString(), true)
        const acquireYAtM150_8 = l2y('1000000', (await logPowMath.getSqrtPrice(-150)).toString(), false)
        const costXAtM150_WithFee_8 = amountAddFee(costXAtM150_8, 100);

        const acquireLimYAtM195_8 = '20000000000000000000';
        const costLimXAtM195_8 = getCostXFromYAt((await logPowMath.getSqrtPrice(-195)).toString(), acquireLimYAtM195_8);
        const costLimXAtM195_WithFee_8 = amountAddFee(costLimXAtM195_8, 100);

        const swap8 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireLimYAtM149_8, acquireYAtM150_8, acquireLimYAtM195_8
        ]), -10000)

        expect(swap8.acquireY).to.equal(getSum([
            acquireLimYAtM149_8, acquireYAtM150_8, acquireLimYAtM195_8
        ]))
        expect(swap8.costX).to.equal(getSum([
            costLimXAtM149_WithFee_8, costXAtM150_WithFee_8, costLimXAtM195_WithFee_8
        ]))
        const state8 = await getState(pool);
        expect(state8.liquidity).to.equal('0')
        expect(state8.liquidityX).to.equal('0')
        expect(state8.currentPoint).to.equal('-195')

        // swap9

        const acquireLimYAtM195_9 = '80000000000000000000';
        const costLimXAtM195_9 = getCostXFromYAt((await logPowMath.getSqrtPrice(-195)).toString(), acquireLimYAtM195_9);
        const costLimXAtM195_WithFee_9 = amountAddFee(costLimXAtM195_9, 100);

        const acquireLimYAtM196_9 = '100000000000000000000';
        const costLimXAtM196_9 = getCostXFromYAt((await logPowMath.getSqrtPrice(-196)).toString(), acquireLimYAtM196_9);
        const costLimXAtM196_WithFee_9 = amountAddFee(costLimXAtM196_9, 100);

        const acquireLimYAtM197_9 = '100000000000000000000';
        const costLimXAtM197_9 = getCostXFromYAt((await logPowMath.getSqrtPrice(-197)).toString(), acquireLimYAtM197_9);
        const costLimXAtM197_WithFee_9 = amountAddFee(costLimXAtM197_9, 100);

        const acquireLimYAtM198_9 = '20000000000000000000';
        const costLimXAtM198_9 = getCostXFromYAt((await logPowMath.getSqrtPrice(-198)).toString(), acquireLimYAtM198_9);
        const costLimXAtM198_WithFee_9 = amountAddFee(costLimXAtM198_9, 100);

        const swap9 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireLimYAtM195_9, acquireLimYAtM196_9, acquireLimYAtM197_9, acquireLimYAtM198_9
        ]), -10000)

        expect(swap9.acquireY).to.equal(getSum([
            acquireLimYAtM195_9, acquireLimYAtM196_9, acquireLimYAtM197_9, acquireLimYAtM198_9
        ]))
        expect(swap9.costX).to.equal(getSum([
            costLimXAtM195_WithFee_9, costLimXAtM196_WithFee_9, costLimXAtM197_WithFee_9, costLimXAtM198_WithFee_9
        ]))
        const state9 = await getState(pool);
        expect(state9.liquidity).to.equal('0')
        expect(state9.liquidityX).to.equal('0')
        expect(state9.currentPoint).to.equal('-198')

        await checkLimOrder(
            '0', costLimXAtM198_9, '0',
            '80000000000000000000', '0', '0',
            costLimXAtM198_9, '0', 
            '0', '0',
            poolAddr, -198)

        // swap10

        const acquireLimYAtM198_10 = '30000000000000000000';
        const costLimXAtM198_10 = getCostXFromYAt((await logPowMath.getSqrtPrice(-198)).toString(), acquireLimYAtM198_10);
        const costLimXAtM198_WithFee_10 = amountAddFee(costLimXAtM198_10, 100);

        const swap10 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireLimYAtM198_10
        ]), -10000)

        expect(swap10.acquireY).to.equal(getSum([
            acquireLimYAtM198_10
        ]))
        expect(swap10.costX).to.equal(getSum([
            costLimXAtM198_WithFee_10
        ]))
        const state10 = await getState(pool);
        expect(state10.liquidity).to.equal('0')
        expect(state10.liquidityX).to.equal('0')
        expect(state10.currentPoint).to.equal('-198')

        await checkLimOrder(
            '0', 
            getSum([costLimXAtM198_9, costLimXAtM198_10]), 
            '0',
            
            '50000000000000000000', 
            '0', 
            '0', 
            
            getSum([costLimXAtM198_9, costLimXAtM198_10]), 
            '0', 

            '0',
            '0',
            
            poolAddr, 
            -198
        )

        // swap11
        const acquireLimYAtM198_11 = '50000000000000000000';
        const costLimXAtM198_11 = getCostXFromYAt((await logPowMath.getSqrtPrice(-198)).toString(), acquireLimYAtM198_11);
        const costLimXAtM198_WithFee_11 = amountAddFee(costLimXAtM198_11, 100);
        const acquireLimYAtM199_11 = '100000000000000000000';
        const costLimXAtM199_11 = getCostXFromYAt((await logPowMath.getSqrtPrice(-199)).toString(), acquireLimYAtM199_11);
        const costLimXAtM199_WithFee_11 = amountAddFee(costLimXAtM199_11, 100);

        const acquireLimYAtM200_11 = '100000000000000000000';
        const costLimXAtM200_11 = getCostXFromYAt((await logPowMath.getSqrtPrice(-200)).toString(), acquireLimYAtM200_11);
        const costLimXAtM200_WithFee_11 = amountAddFee(costLimXAtM200_11, 100);

        const costX_M512_M500 = xInRange('1000000', -512, -500, '1.0001', true)
        const acquireY_M512_M500 = yInRange('1000000', -512, -500, '1.0001', false)
        const costX_M512_M500_WithFee = amountAddFee(costX_M512_M500, 100)


        const costX_M598_M512 = xInRange('1000000', -598, -512, '1.0001', true)
        const acquireY_M598_M512 = yInRange('1000000', -598, -512, '1.0001', false)
        const costX_M598_M512_WithFee = amountAddFee(costX_M598_M512, 100)

        const acquireLimYAtM598_11 = '100000000000000000000';
        const costLimXAtM598_11 = getCostXFromYAt((await logPowMath.getSqrtPrice(-598)).toString(), acquireLimYAtM598_11);
        const costLimXAtM598_WithFee_11 = amountAddFee(costLimXAtM598_11, 100);

        const costXAtM599_11 = l2x('1000000', (await logPowMath.getSqrtPrice(-599)).toString(), true)
        const acquireYAtM599_11 = l2y('1000000', (await logPowMath.getSqrtPrice(-599)).toString(), false)
        const costXAtM599_WithFee_11 = amountAddFee(costXAtM599_11, 100);

        const acquireLimYAtM599_11 = '100000000000000000000';
        const costLimXAtM599_11 = getCostXFromYAt((await logPowMath.getSqrtPrice(-599)).toString(), acquireLimYAtM599_11);
        const costLimXAtM599_WithFee_11 = amountAddFee(costLimXAtM599_11, 100);

        const costXAtM600_11 = l2x('1000000', (await logPowMath.getSqrtPrice(-600)).toString(), true)
        const acquireYAtM600_11 = l2y('1000000', (await logPowMath.getSqrtPrice(-600)).toString(), false)
        const costXAtM600_WithFee_11 = amountAddFee(costXAtM600_11, 100);

        const acquireLimYAtM600_11 = '70000000000000000000';
        const costLimXAtM600_11 = getCostXFromYAt((await logPowMath.getSqrtPrice(-600)).toString(), acquireLimYAtM600_11);
        const costLimXAtM600_WithFee_11 = amountAddFee(costLimXAtM600_11, 100);
        const swap11 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireLimYAtM198_11,
            acquireLimYAtM199_11,
            acquireLimYAtM200_11,
            acquireY_M512_M500,
            acquireY_M598_M512,
            acquireLimYAtM598_11,
            acquireYAtM599_11,
            acquireLimYAtM599_11,
            acquireYAtM600_11,
            acquireLimYAtM600_11
        ]), -10000)
        expect(swap11.acquireY).to.equal(getSum([
            acquireLimYAtM198_11,
            acquireLimYAtM199_11,
            acquireLimYAtM200_11,
            acquireY_M512_M500,
            acquireY_M598_M512,
            acquireLimYAtM598_11,
            acquireYAtM599_11,
            acquireLimYAtM599_11,
            acquireYAtM600_11,
            acquireLimYAtM600_11
        ]))
        expect(swap11.costX).to.equal(getSum([
            costLimXAtM198_WithFee_11,
            costLimXAtM199_WithFee_11,
            costLimXAtM200_WithFee_11,
            costX_M512_M500_WithFee,
            costX_M598_M512_WithFee,
            costLimXAtM598_WithFee_11,
            costXAtM599_WithFee_11,
            costLimXAtM599_WithFee_11,
            costXAtM600_WithFee_11,
            costLimXAtM600_WithFee_11
        ]))

        await checkLimOrder(
            '0', costLimXAtM600_11, '0',
            '30000000000000000000', '0', '0',
            costLimXAtM600_11, '0', 
            '0', '0',
            poolAddr, -600
        )

        // swap12
        const acquireLimYAtM600_12 = '30000000000000000000';
        const costLimXAtM600_12 = getCostXFromYAt((await logPowMath.getSqrtPrice(-600)).toString(), acquireLimYAtM600_12);
        const costLimXAtM600_WithFee_12 = amountAddFee(costLimXAtM600_12, 100);

        const costXAtM601_12 = l2x('1000000', (await logPowMath.getSqrtPrice(-601)).toString(), true)
        const acquireYAtM601_12 = l2y('1000000', (await logPowMath.getSqrtPrice(-601)).toString(), false)
        const costXAtM601_WithFee_12 = amountAddFee(costXAtM601_12, 100);

        const acquireLimYAtM601_12 = '100000000000000000000';
        const costLimXAtM601_12 = getCostXFromYAt((await logPowMath.getSqrtPrice(-601)).toString(), acquireLimYAtM601_12);
        const costLimXAtM601_WithFee_12 = amountAddFee(costLimXAtM601_12, 100);

        const costX_M768_M601 = xInRange('1000000', -768, -601, '1.0001', true)
        const acquireY_M768_M601 = yInRange('1000000', -768, -601, '1.0001', false)
        const costX_M768_M601_WithFee = amountAddFee(costX_M768_M601, 100)

        const costX_M896_M768 = xInRange('1000000', -896, -768, '1.0001', true)
        const acquireY_M896_M768 = yInRange('1000000', -896, -768, '1.0001', false)
        const costX_M896_M768_WithFee = amountAddFee(costX_M896_M768, 100)


        const acquireLimYAtM896_12 = '100000000000000000000';
        const costLimXAtM896_12 = getCostXFromYAt((await logPowMath.getSqrtPrice(-896)).toString(), acquireLimYAtM896_12);
        const costLimXAtM896_WithFee_12 = amountAddFee(costLimXAtM896_12, 100);


        const costXAtM897_12 = l2x('1000000', (await logPowMath.getSqrtPrice(-897)).toString(), true)
        const acquireYAtM897_12 = l2y('1000000', (await logPowMath.getSqrtPrice(-897)).toString(), false)
        const costXAtM897_WithFee_12 = amountAddFee(costXAtM897_12, 100);

        const acquireLimYAtM897_12 = '100000000000000000000';
        const costLimXAtM897_12 = getCostXFromYAt((await logPowMath.getSqrtPrice(-897)).toString(), acquireLimYAtM897_12);
        const costLimXAtM897_WithFee_12 = amountAddFee(costLimXAtM897_12, 100);


        const costXAtM898_12 = l2x('1000000', (await logPowMath.getSqrtPrice(-898)).toString(), true)
        const acquireYAtM898_12 = l2y('1000000', (await logPowMath.getSqrtPrice(-898)).toString(), false)
        const costXAtM898_WithFee_12 = amountAddFee(costXAtM898_12, 100);

        const acquireLimYAtM898_12 = '70000000000000000000';
        const costLimXAtM898_12 = getCostXFromYAt((await logPowMath.getSqrtPrice(-898)).toString(), acquireLimYAtM898_12);
        const costLimXAtM898_WithFee_12 = amountAddFee(costLimXAtM898_12, 100);


        const swap12 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireLimYAtM600_12,
            acquireYAtM601_12,
            acquireLimYAtM601_12,
            acquireY_M768_M601,
            acquireY_M896_M768,
            acquireLimYAtM896_12,
            acquireYAtM897_12,
            acquireLimYAtM897_12,
            acquireYAtM898_12,
            acquireLimYAtM898_12
        ]), -10000)
        expect(swap12.acquireY).to.equal(getSum([
            acquireLimYAtM600_12,
            acquireYAtM601_12,
            acquireLimYAtM601_12,
            acquireY_M768_M601,
            acquireY_M896_M768,
            acquireLimYAtM896_12,
            acquireYAtM897_12,
            acquireLimYAtM897_12,
            acquireYAtM898_12,
            acquireLimYAtM898_12
        ]))
        expect(swap12.costX).to.equal(getSum([
            costLimXAtM600_WithFee_12,
            costXAtM601_WithFee_12,
            costLimXAtM601_WithFee_12,
            costX_M768_M601_WithFee,
            costX_M896_M768_WithFee,
            costLimXAtM896_WithFee_12,
            costXAtM897_WithFee_12,
            costLimXAtM897_WithFee_12,
            costXAtM898_WithFee_12,
            costLimXAtM898_WithFee_12
        ]))
        await checkLimOrder(
            '0', costLimXAtM898_12, '0',
            '30000000000000000000', '0', '0',
            costLimXAtM898_12, '0', 
            '0','0',
            poolAddr, -898)

        // swap13
        const acquireLimYAtM898_13 = '30000000000000000000';
        const costLimXAtM898_13 = getCostXFromYAt((await logPowMath.getSqrtPrice(-898)).toString(), acquireLimYAtM898_13);
        const costLimXAtM898_WithFee_13 = amountAddFee(costLimXAtM898_13, 100);

        const costXAtM899_13 = l2x('200000', (await logPowMath.getSqrtPrice(-899)).toString(), true)
        const acquireYAtM899_13 = l2y('200000', (await logPowMath.getSqrtPrice(-899)).toString(), false)
        const costXAtM899_WithFee_13 = amountAddFee(costXAtM899_13, 100);

        const swap13 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 100, getSum([
            acquireLimYAtM898_13, acquireYAtM899_13
        ]), -10000)
        expect(swap13.acquireY).to.equal(getSum([
            acquireLimYAtM898_13, acquireYAtM899_13
        ]))
        expect(swap13.costX).to.equal(getSum([
            costLimXAtM898_WithFee_13, costXAtM899_WithFee_13
        ]))
        await checkLimOrder(
            '0', '0', '0',
            '100000000000000000000', '0', '0',
            '0', '0', 
            '0', '0', 
            poolAddr, -899)
        const state13 = await getState(pool);
        expect(state13.liquidity).to.equal('1000000')
        expect(state13.liquidityX).to.equal('200000')
        expect(state13.currentPoint).to.equal('-899')
    });

});