const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

const {getFeeCharge, getCostXFromYAt, amountAddFee, xInRange, yInRange, getPoolParts, l2x, l2y, getState, addLiquidity, checkLimOrder} = require('../funcs');
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
    const fee = getFee(cost, '3000');
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

async function swapX2Y(testSwap, trader, tokenX, tokenY, fee, amountX, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, fee, amountX, lowPt);
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
        await factory.enableFeeAmount(3000, 50);

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, 3000);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);

        const LogPowMathTest = await ethers.getContractFactory('LogPowMathTest');
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

        const getPoolAddr = await testMint.pool(txAddr, tyAddr, 3000);
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
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1900, 3000, '1000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, 1550, 1900, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -700, 1000, '1000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -1050, -700, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1350, -1050, '1000000');

        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -250);

        const costX_2051_3000 = xInRange('1000000', 2051, 3000, '1.0001', true);
        const acquireY_2051_3000 = yInRange('1000000', 2051, 3000, '1.0001', false);

        const costXAt2050 = l2x('300000', (await logPowMath.getSqrtPrice(2050)).toString(), true);
        const acquireYAt2050 = l2y('300000', (await logPowMath.getSqrtPrice(2050)).toString(), false);
        const swap0 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountAddFee(getSum([
            costX_2051_3000, costXAt2050
        ])), -15000);

        expect(swap0.acquireY).to.equal(getSum([acquireY_2051_3000, acquireYAt2050]));
        expect(swap0.costX).to.equal(amountAddFee(getSum([costX_2051_3000, costXAt2050])));

        const state0 = await getState(pool);
        expect(state0.liquidity).to.equal('1000000')
        expect(state0.liquidityX).to.equal('300000')
        expect(state0.currentPoint).to.equal('2050')

        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '30000000000000000000', 2050);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '20000000000000000000', -1050);

        // swap1
        const costXAt1700_1 = l2x('500000', (await logPowMath.getSqrtPrice(1700)).toString(), true);
        const acquireYAt1700_1 = l2y('500000', (await logPowMath.getSqrtPrice(1700)).toString(), false);

        const costX_1701_1900 = xInRange('2000000', 1701, 1900, '1.0001', true);
        const acquireY_1701_1900 = yInRange('2000000', 1701, 1900, '1.0001', false);
        const costX_1900_2050 = xInRange('1000000', 1900, 2050, '1.0001', true);
        const acquireY_1900_2050 = yInRange('1000000', 1900, 2050, '1.0001', false);
        const costXAt2050_1 = l2x('700000', (await logPowMath.getSqrtPrice(2050)).toString(), true);
        const acquireYAt2050_1 = l2y('700000', (await logPowMath.getSqrtPrice(2050)).toString(), false);

        const costX_1700_1900_WithFee = amountAddFee(getSum([
            costXAt1700_1, costX_1701_1900
        ]))
        const costX_1900_2050_WithFee = amountAddFee(getSum([
            costX_1900_2050, costXAt2050_1
        ]))
        const swap1 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            costX_1700_1900_WithFee, costX_1900_2050_WithFee
        ]), -15000);
        expect(swap1.acquireY).to.equal(getSum([acquireYAt1700_1, acquireY_1701_1900, acquireY_1900_2050, acquireYAt2050_1]));
        expect(swap1.costX).to.equal(getSum([
            costX_1700_1900_WithFee, costX_1900_2050_WithFee
        ]));
        const state1 = await getState(pool);
        expect(state1.liquidity).to.equal('2000000')
        expect(state1.liquidityX).to.equal('500000')
        expect(state1.currentPoint).to.equal('1700')

        // swap2
        const costX_50_1000 = xInRange('1000000', 50, 1000, '1.0001', true);
        const acquireY_50_1000 = yInRange('1000000', 50, 1000, '1.0001', false);
        const costX_1550_1700 = xInRange('2000000', 1550, 1700, '1.0001', true);
        const acquireY_1550_1700 = yInRange('2000000', 1550, 1700, '1.0001', false);

        const costXAt1700_2 = l2x('1500000', (await logPowMath.getSqrtPrice(1700)).toString(), true);
        const acquireYAt1700_2 = l2y('1500000', (await logPowMath.getSqrtPrice(1700)).toString(), false);

        const costX_50_1000_WithFee = amountAddFee(costX_50_1000);
        const costX_1550_1700_WithFee = amountAddFee(getSum([costX_1550_1700, costXAt1700_2]))

        const swap2 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            costX_50_1000_WithFee, costX_1550_1700_WithFee, '10000000000000000000000'
        ]), 50);
        expect(swap2.acquireY).to.equal(getSum([acquireY_50_1000, acquireY_1550_1700, acquireYAt1700_2]));
        expect(swap2.costX).to.equal(getSum([
            costX_50_1000_WithFee, costX_1550_1700_WithFee
        ]));
        const state2 = await getState(pool);
        expect(state2.liquidity).to.equal('1000000')
        expect(state2.liquidityX).to.equal('1000000')
        expect(state2.currentPoint).to.equal('50')
        
        // swap3
        const acquireYAtM250_3 = '2000000000000000000';
        const costXAtM250_3 = await getCostXFromYAt((await logPowMath.getSqrtPrice(-250)).toString(), acquireYAtM250_3);
        const costXAtM250_WithFee_3 = amountAddFee(costXAtM250_3);

        const costX_M250_0 = xInRange('1000000', -250, 0, '1.0001', true);
        const acquireY_M250_0 = yInRange('1000000', -250, 0, '1.0001', false);
        const costX_M250_0_WithFee = amountAddFee(costX_M250_0);

        const costX_0_50 = xInRange('1000000', 0, 50, '1.0001', true);
        const acquireY_0_50 = yInRange('1000000', 0, 50, '1.0001', false);
        const costX_0_50_WithFee = amountAddFee(costX_0_50);
        
        const swap3 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            costXAtM250_WithFee_3, costX_M250_0_WithFee, costX_0_50_WithFee
        ]), -100000);
        expect(swap3.acquireY).to.equal(getSum([acquireYAtM250_3, acquireY_M250_0, acquireY_0_50]));
        expect(swap3.costX).to.equal(getSum([
            costXAtM250_WithFee_3, costX_M250_0_WithFee, costX_0_50_WithFee
        ]));
        const state3 = await getState(pool);
        expect(state3.liquidity).to.equal('1000000')
        expect(state3.liquidityX).to.equal('1000000')
        expect(state3.currentPoint).to.equal('-250')
        await checkLimOrder('0', costXAtM250_3, '8000000000000000000', '0', costXAtM250_3, '0', poolAddr, -250);

        // swap4
        const costX_M700_M250 = xInRange('1000000', -700, -250, '1.0001', true);
        const acquireY_M700_M250 = yInRange('1000000', -700, -250, '1.0001', false);
        const costX_M700_M250_WithFee = amountAddFee(costX_M700_M250);
        const acquireYAtM250_4 = '8000000000000000000';
        const costXAtM250_4 = await getCostXFromYAt((await logPowMath.getSqrtPrice(-250)).toString(), acquireYAtM250_4);
        const costXAtM250_WithFee_4 = amountAddFee(costXAtM250_4);

        const swap4 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            costX_M700_M250_WithFee, costXAtM250_WithFee_4, '1'
        ]), -100000);
        expect(swap4.acquireY).to.equal(getSum([acquireY_M700_M250, acquireYAtM250_4]));
        expect(swap4.costX).to.equal(getSum([
            costX_M700_M250_WithFee, costXAtM250_WithFee_4
        ]));

        // swap5

        const costXAtM1206_5 = l2x('800000', (await logPowMath.getSqrtPrice(-1206)).toString(), true);
        const acquireYAtM1206_5 = l2y('800000', (await logPowMath.getSqrtPrice(-1206)).toString(), false);

        const costX_M1205_M1050 = xInRange('1000000', -1205, -1050, '1.0001', true);
        const acquireY_M1205_M1050 = yInRange('1000000', -1205, -1050, '1.0001', false);
        const costX_M1206_M1050_WithFee = amountAddFee(getSum([costXAtM1206_5, costX_M1205_M1050]));

        const acquireYAtM1050_5 = '20000000000000000000';
        const costXAtM1050_5 = await getCostXFromYAt((await logPowMath.getSqrtPrice(-1050)).toString(), acquireYAtM1050_5);
        const costXAtM1050_WithFee_5 = amountAddFee(costXAtM1050_5);

        const costX_M1050_M700 = xInRange('2000000', -1050, -700, '1.0001', true);
        const acquireY_M1050_M700 = yInRange('2000000', -1050, -700, '1.0001', false);
        const costX_M1049_M700_WithFee = amountAddFee(costX_M1050_M700);


        const swap5 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            costX_M1206_M1050_WithFee, costXAtM1050_WithFee_5, costX_M1049_M700_WithFee
        ]), -100000);
        const state5 = await getState(pool);
        expect(state5.currentPoint).to.equal('-1206')
        expect(state5.liquidity).to.equal('1000000')
        expect(state5.liquidityX).to.equal('800000')
        await checkLimOrder('0', costXAtM1050_5, '0', '0', costXAtM1050_5, '0', poolAddr, -1050);

        expect(swap5.acquireY).to.equal(getSum([acquireYAtM1206_5, acquireY_M1205_M1050, acquireYAtM1050_5, acquireY_M1050_M700]));
        expect(swap5.costX).to.equal(getSum([
            costX_M1206_M1050_WithFee, costXAtM1050_WithFee_5, costX_M1049_M700_WithFee
        ]));
    });

    it("(2)", async function () {

        this.timeout(1000000);
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -9000, -6000, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -6000, -4000, '1000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -4000, 2000, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2000, 6000, '1000000');

        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -8000);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -6000);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -3000);
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', 3000);

        const costX_2000_3001 = xInRange('1000000', 2000, 3001, '1.0001', true);
        const acquireY_2000_3001 = yInRange('1000000', 2000, 3001, '1.0001', false);
        const costX_2000_3001_WithFee = amountAddFee(costX_2000_3001);

        const swap0 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costX_2000_3001_WithFee, -15000);
        expect(swap0.costX).to.equal(costX_2000_3001_WithFee);
        expect(swap0.acquireY).to.equal(acquireY_2000_3001);

        const state0 = await getState(pool);
        expect(state0.liquidity).to.equal('1000000')
        expect(state0.liquidityX).to.equal('1000000')
        expect(state0.currentPoint).to.equal('2000')
        await checkLimOrder('10000000000000000000', '0', '0', '0', '0', '0', poolAddr, 3000);
        // swap1
        const costX_0_2000 = xInRange('2000000', 0, 2000, '1.0001', true);
        const acquireY_0_2000 = yInRange('2000000', 0, 2000, '1.0001', false);
        const costX_0_2000_WithFee = amountAddFee(costX_0_2000);
        const costX_M3000_0 = xInRange('2000000', -3000, 0, '1.0001', true);
        const acquireY_M3000_0 = yInRange('2000000', -3000, 0, '1.0001', false);
        const costX_M3000_0_WithFee = amountAddFee(costX_M3000_0);

        const swap1 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costX_M3000_0_WithFee, costX_0_2000_WithFee]), -15000);
        expect(swap1.costX).to.equal(getSum([costX_M3000_0_WithFee, costX_0_2000_WithFee]));
        expect(swap1.acquireY).to.equal(getSum([acquireY_M3000_0, acquireY_0_2000]));

        const acquireYAtM3000 = '10000000000000000000';
        const costXAtM3000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-3000)).toString(), acquireYAtM3000);
        const costXAtM3000_WithFee = amountAddFee(costXAtM3000);

        const costX_M4000_M3000 = xInRange('2000000', -4000, -3000, '1.0001', true);
        const acquireY_M4000_M3000 = yInRange('2000000', -4000, -3000, '1.0001', false);
        const costX_M4000_M3000_WithFee = amountAddFee(costX_M4000_M3000);
        // swap2
        const swap2 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum(['1', costX_M4000_M3000_WithFee, costXAtM3000_WithFee]), -15000);
        expect(swap2.costX).to.equal(getSum([costX_M4000_M3000_WithFee, costXAtM3000_WithFee]));
        expect(swap2.acquireY).to.equal(getSum([acquireY_M4000_M3000, acquireYAtM3000]));

        await checkLimOrder('0', costXAtM3000, '0', '0', costXAtM3000, '0', poolAddr, -3000)

        // swap3
        const costX_M5000_M4000 = xInRange('1000000', -5000, -4000, '1.0001', true);
        const acquireY_M5000_M4000 = yInRange('1000000', -5000, -4000, '1.0001', false);
        const costX_M5000_M4000_WithFee = amountAddFee(costX_M5000_M4000);

        const swap3 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costX_M5000_M4000_WithFee, -5000);
        expect(swap3.costX).to.equal(costX_M5000_M4000_WithFee);
        expect(swap3.acquireY).to.equal(acquireY_M5000_M4000);

        // swap4
        const costXAtM7000_4 = l2x('300000', (await logPowMath.getSqrtPrice(-7000)).toString(), true)
        const acquireYAtM7000_4 = l2y('300000', (await logPowMath.getSqrtPrice(-7000)).toString(), false)

        const costX_M6999_M6000 = xInRange('2000000', -6999, -6000, '1.0001', true);
        const acquireY_M6999_M6000 = yInRange('2000000', -6999, -6000, '1.0001', false);

        const costX_M7000_M6000_WithFee = amountAddFee(getSum([costXAtM7000_4, costX_M6999_M6000]))
        
        const acquireYAtM6000 = '10000000000000000000';
        const costXAtM6000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-6000)).toString(), acquireYAtM6000);
        const costXAtM6000_WithFee = amountAddFee(costXAtM6000);

        const costX_M6000_M5000 = xInRange('1000000', -6000, -5000, '1.0001', true);
        const acquireY_M6000_M5000 = yInRange('1000000', -6000, -5000, '1.0001', false);
        const costX_M6000_M5000_WithFee = amountAddFee(costX_M6000_M5000)

        const swap4 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costX_M7000_M6000_WithFee, costXAtM6000_WithFee, costX_M6000_M5000_WithFee]), -15000);
        expect(swap4.costX).to.equal(getSum([costX_M7000_M6000_WithFee, costXAtM6000_WithFee, costX_M6000_M5000_WithFee]));
        expect(swap4.acquireY).to.equal(getSum([acquireYAtM7000_4, acquireY_M6999_M6000, acquireYAtM6000, acquireY_M6000_M5000]));

        const state4 = await getState(pool);
        expect(state4.liquidity).to.equal('2000000')
        expect(state4.liquidityX).to.equal('300000')
        expect(state4.currentPoint).to.equal('-7000')


        // swap5
        const costXAtM7000_5 = l2x('1700000', (await logPowMath.getSqrtPrice(-7000)).toString(), true)
        const acquireYAtM7000_5 = l2y('1700000', (await logPowMath.getSqrtPrice(-7000)).toString(), false)

        const costX_M8000_M7000 = xInRange('2000000', -8000, -7000, '1.0001', true);
        const acquireY_M8000_M7000 = yInRange('2000000', -8000, -7000, '1.0001', false);

        const costX_M8000_M7000_WithFee = amountAddFee(getSum([costXAtM7000_5, costX_M8000_M7000]))
        
        const acquireYAtM8000 = '10000000000000000000';
        const costXAtM8000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-8000)).toString(), acquireYAtM8000);
        const costXAtM8000_WithFee = amountAddFee(costXAtM8000);

        const swap5 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costXAtM8000_WithFee, costX_M8000_M7000_WithFee]), -15000);
        expect(swap5.costX).to.equal(getSum([costXAtM8000_WithFee, costX_M8000_M7000_WithFee]));
        expect(swap5.acquireY).to.equal(getSum([acquireYAtM7000_5, acquireY_M8000_M7000, acquireYAtM8000]));

        const state5 = await getState(pool);
        expect(state5.liquidity).to.equal('2000000')
        expect(state5.liquidityX).to.equal('2000000')
        expect(state5.currentPoint).to.equal('-8000')

        await checkLimOrder('0', costXAtM8000, '0', '0', costXAtM8000, '0', poolAddr, -8000)
    });

    
    it("(3)", async function () {

        this.timeout(1000000);
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 3000, '1000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -3000, -2000, '2000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -6000, -4000, '2000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -7000, -6000, '1000000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -8000, -7000, '2000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -9000, -8000, '2000000');

        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -8000);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -6000);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -5000);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', -3000);
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', 1000);

        // swap0

        const costX_1000_3000 = xInRange('1000000', 1000, 3000, '1.0001', true);
        const acquireY_1000_3000 = yInRange('1000000', 1000, 3000, '1.0001', false);
        const costX_1000_3000_WithFee = amountAddFee(costX_1000_3000);

        const acquireYAt1000 = '10000000000000000000';
        const costXAt1000 = getCostXFromYAt((await logPowMath.getSqrtPrice(1000)).toString(), acquireYAt1000);
        const costXAt1000_WithFee = amountAddFee(costXAt1000);


        const swap0 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costX_1000_3000_WithFee, costXAt1000_WithFee, '1']), -15000);
        expect(swap0.costX).to.equal(getSum([costX_1000_3000_WithFee, costXAt1000_WithFee]));
        expect(swap0.acquireY).to.equal(getSum([acquireY_1000_3000, acquireYAt1000]));

        const state0 = await getState(pool);
        expect(state0.liquidity).to.equal('1000000')
        expect(state0.liquidityX).to.equal('1000000')
        expect(state0.currentPoint).to.equal('1000')
        await checkLimOrder('0', costXAt1000, '0', '0', costXAt1000, '0', poolAddr, 1000);
        
        // swap1
        const acquireYAtM3000 = '10000000000000000000';
        const costXAtM3000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-3000)).toString(), acquireYAtM3000);
        const costXAtM3000_WithFee = amountAddFee(costXAtM3000);

        const costX_M3000_M2000 = xInRange('2000000', -3000, -2000, '1.0001', true);
        const acquireY_M3000_M2000 = yInRange('2000000', -3000, -2000, '1.0001', false);
        const costX_M3000_M2000_WithFee = amountAddFee(costX_M3000_M2000);

        const costX_M2000_0 = xInRange('1000000', -2000, 0, '1.0001', true);
        const acquireY_M2000_0 = yInRange('1000000', -2000, 0, '1.0001', false);
        const costX_M2000_0_WithFee = amountAddFee(costX_M2000_0);

        const costX_0_1000 = xInRange('1000000', 0, 1000, '1.0001', true);
        const acquireY_0_1000 = yInRange('1000000', 0, 1000, '1.0001', false);
        const costX_0_1000_WithFee = amountAddFee(costX_0_1000);

        const swap1 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costXAtM3000_WithFee, costX_M3000_M2000_WithFee, costX_M2000_0_WithFee, costX_0_1000_WithFee, '1']), -15000);
        expect(swap1.costX).to.equal(getSum([costXAtM3000_WithFee, costX_M3000_M2000_WithFee, costX_M2000_0_WithFee, costX_0_1000_WithFee]));
        expect(swap1.acquireY).to.equal(getSum([acquireYAtM3000, acquireY_M3000_M2000, acquireY_M2000_0, acquireY_0_1000]));

        const state1 = await getState(pool);
        expect(state1.liquidity).to.equal('2000000')
        expect(state1.liquidityX).to.equal('2000000')
        expect(state1.currentPoint).to.equal('-3000')
        await checkLimOrder('0', costXAtM3000, '0', '0', costXAtM3000, '0', poolAddr, -3000);

        // swap2
        const acquireYAtM5000 = '10000000000000000000';
        const costXAtM5000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-5000)).toString(), acquireYAtM5000);
        const costXAtM5000_WithFee = amountAddFee(costXAtM5000);

        const costX_M5000_M4000 = xInRange('2000000', -5000, -4000, '1.0001', true);
        const acquireY_M5000_M4000 = yInRange('2000000', -5000, -4000, '1.0001', false);
        const costX_M5000_M4000_WithFee = amountAddFee(costX_M5000_M4000);

        const swap2 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costXAtM5000_WithFee, costX_M5000_M4000_WithFee, '1']), -15000);
        expect(swap2.costX).to.equal(getSum([costXAtM5000_WithFee, costX_M5000_M4000_WithFee]));
        expect(swap2.acquireY).to.equal(getSum([acquireYAtM5000, acquireY_M5000_M4000]));

        const state2 = await getState(pool);
        expect(state2.liquidity).to.equal('2000000')
        expect(state2.liquidityX).to.equal('2000000')
        expect(state2.currentPoint).to.equal('-5000')
        await checkLimOrder('0', costXAtM5000, '0', '0', costXAtM5000, '0', poolAddr, -5000);


        // swap3
        const acquireYAtM6000 = '10000000000000000000';
        const costXAtM6000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-6000)).toString(), acquireYAtM6000);
        const costXAtM6000_WithFee = amountAddFee(costXAtM6000);

        const costX_M6000_M5000 = xInRange('2000000', -6000, -5000, '1.0001', true);
        const acquireY_M6000_M5000 = yInRange('2000000', -6000, -5000, '1.0001', false);
        const costX_M6000_M5000_WithFee = amountAddFee(costX_M6000_M5000);

        const swap3 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costXAtM6000_WithFee, costX_M6000_M5000_WithFee]), -15000);
        expect(swap3.costX).to.equal(getSum([costXAtM6000_WithFee, costX_M6000_M5000_WithFee]));
        expect(swap3.acquireY).to.equal(getSum([acquireYAtM6000, acquireY_M6000_M5000]));

        const state3 = await getState(pool);
        expect(state3.liquidity).to.equal('2000000')
        expect(state3.liquidityX).to.equal('2000000')
        expect(state3.currentPoint).to.equal('-6000')
        await checkLimOrder('0', costXAtM6000, '0', '0', costXAtM6000, '0', poolAddr, -6000);


        // swap4

        const costX_M7000_M6000 = xInRange('1000000', -7000, -6000, '1.0001', true);
        const acquireY_M7000_M6000 = yInRange('1000000', -7000, -6000, '1.0001', false);
        const costX_M7000_M6000_WithFee = amountAddFee(costX_M7000_M6000);

        const costX_M8000_M7000 = xInRange('2000000', -8000, -7000, '1.0001', true);
        const acquireY_M8000_M7000 = yInRange('2000000', -8000, -7000, '1.0001', false);
        const costX_M8000_M7000_WithFee = amountAddFee(costX_M8000_M7000);

        const swap4 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costX_M8000_M7000_WithFee, costX_M7000_M6000_WithFee]), -15000);
        expect(swap4.costX).to.equal(getSum([costX_M8000_M7000_WithFee, costX_M7000_M6000_WithFee]));
        expect(swap4.acquireY).to.equal(getSum([acquireY_M8000_M7000, acquireY_M7000_M6000]));

        const state4 = await getState(pool);
        expect(state4.liquidity).to.equal('2000000')
        expect(state4.liquidityX).to.equal('2000000')
        expect(state4.currentPoint).to.equal('-8000')
        await checkLimOrder('0', '0', '10000000000000000000', '0', '0', '0', poolAddr, -8000);

        // swap5

        const acquireYAtM8000 = '8000000000000000000';
        const costXAtM8000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-8000)).toString(), acquireYAtM8000);
        const costXAtM8000_WithFee = amountAddFee(costXAtM8000);

        const swap5 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAtM8000_WithFee, -15000);
        expect(swap5.costX).to.equal(costXAtM8000_WithFee);
        expect(swap5.acquireY).to.equal(acquireYAtM8000);

        const state5 = await getState(pool);
        expect(state5.liquidity).to.equal('2000000')
        expect(state5.liquidityX).to.equal('2000000')
        expect(state5.currentPoint).to.equal('-8000')
        await checkLimOrder('0', costXAtM8000, '2000000000000000000', '0', costXAtM8000, '0', poolAddr, -8000);
    });


    it("(4)", async function () {

        this.timeout(1000000);
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -20000, -10000, '3000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -10000, 2500, '2000000');
        await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 2500, 3000, '1000000');
        

        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '10000000000000000000', 2350);
        

        // swap0

        const costX_2501_3000 = xInRange('1000000', 2501, 3000, '1.0001', true);
        const acquireY_2501_3000 = yInRange('1000000', 2501, 3000, '1.0001', false);

        const costXAt2500_0 = l2x('200000', (await logPowMath.getSqrtPrice(2500)).toString(), true)
        const acquireYAt2500_0 = l2y('200000', (await logPowMath.getSqrtPrice(2500)).toString(), false)

        const costX_2500_3000_WithFee = amountAddFee(getSum([costXAt2500_0, costX_2501_3000]));


        const swap0 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costX_2500_3000_WithFee, -15000);
        expect(swap0.costX).to.equal(costX_2500_3000_WithFee);
        expect(swap0.acquireY).to.equal(getSum([acquireY_2501_3000, acquireYAt2500_0]));

        const state0 = await getState(pool);
        expect(state0.liquidity).to.equal('1000000')
        expect(state0.liquidityX).to.equal('200000')
        expect(state0.currentPoint).to.equal('2500')

        // swap1

        const costXAt2500_1 = l2x('800000', (await logPowMath.getSqrtPrice(2500)).toString(), true)
        const acquireYAt2500_1 = l2y('800000', (await logPowMath.getSqrtPrice(2500)).toString(), false)
        const costXAt2500_WithFee_1 = amountAddFee(costXAt2500_1)

        const costX_2350_2500 = xInRange('2000000', 2350, 2500, '1.0001', true);
        const acquireY_2350_2500 = yInRange('2000000', 2350, 2500, '1.0001', false);
        const costX_2350_2500_WithFee_1 = amountAddFee(costX_2350_2500)

        const acquireYAt2350 = '10000000000000000000';
        const costXAt2350 = getCostXFromYAt((await logPowMath.getSqrtPrice(2350)).toString(), acquireYAt2350);
        const costXAt2350_WithFee = amountAddFee(costXAt2350);

        const costX_0_2350= xInRange('2000000', 0, 2350, '1.0001', true);
        const acquireY_0_2350 = yInRange('2000000', 0, 2350, '1.0001', false);
        const costX_0_2350_WithFee_1 = amountAddFee(costX_0_2350)


        const costX_M9999_0 = xInRange('2000000', -9999, 0, '1.0001', true);
        const acquireY_M9999_0= yInRange('2000000', -9999, 0, '1.0001', false);

        const costXAtM10000_1 = l2x('10000', (await logPowMath.getSqrtPrice(-10000)).toString(), true)
        const acquireYAtM10000_1 = l2y('10000', (await logPowMath.getSqrtPrice(-10000)).toString(), false)
        const costX_M10000_0_WithFee_1 = amountAddFee(getSum([costXAtM10000_1, costX_M9999_0]))


        const swap1 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([costXAt2500_WithFee_1, costX_2350_2500_WithFee_1, costXAt2350_WithFee, costX_0_2350_WithFee_1, costX_M10000_0_WithFee_1]), -15000);
        expect(swap1.costX).to.equal(getSum([costXAt2500_WithFee_1, costX_2350_2500_WithFee_1, costXAt2350_WithFee, costX_0_2350_WithFee_1, costX_M10000_0_WithFee_1]));
        expect(swap1.acquireY).to.equal(getSum([acquireYAt2500_1, acquireY_2350_2500, acquireYAt2350, acquireY_0_2350, acquireY_M9999_0, acquireYAtM10000_1]));

        const state1 = await getState(pool);
        expect(state1.liquidity).to.equal('2000000')
        expect(state1.liquidityX).to.equal('10000')
        expect(state1.currentPoint).to.equal('-10000')
        await checkLimOrder('0', costXAt2350, '0', '0', costXAt2350, '0', poolAddr, 2350);

        // swap2

        // console.log('2000: ', l2x('2000', (await logPowMath.getSqrtPrice(-10000)).toString(), true))
        // console.log('2001: ', l2x('2001', (await logPowMath.getSqrtPrice(-10000)).toString(), true))

        const costXAt10000_2 = l2x('2000', (await logPowMath.getSqrtPrice(-10000)).toString(), true)
        const amountXAt10000_2 = stringAdd(costXAt10000_2, '1');
        const acquireYAt10000_2 = l2y('2000', (await logPowMath.getSqrtPrice(-10000)).toString(), false)

        const amountXAt10000_WithFee_2 = amountAddFee(amountXAt10000_2);
        const costXAt10000_WithFee_2 = amountAddFee(costXAt10000_2);


        const swap2 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXAt10000_WithFee_2, -15000);
        expect(swap2.costX).to.equal(costXAt10000_WithFee_2);
        expect(swap2.acquireY).to.equal(acquireYAt10000_2);

        const state2 = await getState(pool);
        expect(state2.liquidity).to.equal('2000000')
        expect(state2.liquidityX).to.equal('12000')
        expect(state2.currentPoint).to.equal('-10000')

        // swap3
        
        const costXAt10000_3 = l2x('1988000', (await logPowMath.getSqrtPrice(-10000)).toString(), true)
        const acquireYAt10000_3 = l2y('1988000', (await logPowMath.getSqrtPrice(-10000)).toString(), false)

        const costXAt10000_WithFee_3 = amountAddFee(costXAt10000_3);


        const swap3 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAt10000_WithFee_3, -15000);
        expect(swap3.costX).to.equal(costXAt10000_WithFee_3);
        expect(swap3.acquireY).to.equal(acquireYAt10000_3);

        const state3 = await getState(pool);
        expect(state3.liquidity).to.equal('2000000')
        expect(state3.liquidityX).to.equal('2000000')
        expect(state3.currentPoint).to.equal('-10000')
    });
});