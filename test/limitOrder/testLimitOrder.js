const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

const {getFeeCharge, getCostYFromXAt, amountAddFee, xInRange, yInRange, getPoolParts, l2x, l2y, getState, addLiquidity, checkLimOrder, getCostXFromYAt, getEarnXFromYAt, getLimOrder, getEarnYFromXAt} = require('../funcs');
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

function convertUserEarnFromBC(userEarnBC) {
    return {
        lastAccEarn: userEarnBC.lastAccEarn.toString(),
        sellingRemain: userEarnBC.sellingRemain.toString(),
        sellingDesc: userEarnBC.sellingDesc.toString(),
        earn: stringAdd(userEarnBC.earn.toString(), userEarnBC.legacyEarn.toString()),
        earnAssign: userEarnBC.earnAssign.toString(),
    }
}

async function getEarnX(testAddLimOrder, poolAddr, sellerAddr, point) {
    return convertUserEarnFromBC(
        await testAddLimOrder.getEarnX(poolAddr, sellerAddr, point)
    )
}


async function getEarnY(testAddLimOrder, poolAddr, sellerAddr, point) {
    return convertUserEarnFromBC(
        await testAddLimOrder.getEarnY(poolAddr, sellerAddr, point)
    )
}

async function decLimOrderWithY(seller, testAddLimOrder, deltaY, point, poolAddr) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    var pool = await iZiSwapPool.attach(poolAddr);
    const earnBefore = await getEarnX(testAddLimOrder, poolAddr, seller.address, point)
    await pool.connect(seller).decLimOrderWithY(
        point, deltaY
    );
    const earnAfter = await getEarnX(testAddLimOrder, poolAddr, seller.address, point)
    const sellingReduce = stringMinus(earnBefore.sellingRemain, earnAfter.sellingRemain)
    const actualDec = stringMinus(earnAfter.sellingDesc, earnBefore.sellingDesc)
    const earn = stringMinus(earnAfter.earn, earnBefore.earn)
    const sold = stringMinus(sellingReduce, actualDec)
    return {
        earnBefore,
        earnAfter,
        sellingReduce,
        actualDec,
        earn,
        sold
    }
}

async function addLimOrderWithX(tokenX, tokenY, seller, testAddLimOrder, amountX, point, poolAddr) {
    await tokenX.transfer(seller.address, amountX);
    await tokenX.connect(seller).approve(testAddLimOrder.address, amountX);
    await testAddLimOrder.connect(seller).addLimOrderWithX(
        tokenX.address, tokenY.address, 3000, point, amountX
    );
}

async function decLimOrderWithX(seller, testAddLimOrder, deltaX, point, poolAddr) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    var pool = await iZiSwapPool.attach(poolAddr);
    const earnBefore = await getEarnY(testAddLimOrder, poolAddr, seller.address, point)
    await pool.connect(seller).decLimOrderWithX(
        point, deltaX
    );
    const earnAfter = await getEarnY(testAddLimOrder, poolAddr, seller.address, point)
    const sellingReduce = stringMinus(earnBefore.sellingRemain, earnAfter.sellingRemain)
    const actualDec = stringMinus(earnAfter.sellingDesc, earnBefore.sellingDesc)
    const earn = stringMinus(earnAfter.earn, earnBefore.earn)
    const sold = stringMinus(sellingReduce, actualDec)
    return {
        earnBefore,
        earnAfter,
        sellingReduce,
        actualDec,
        earn,
        sold
    }
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

async function swapY2X(testSwap, trader, tokenX, tokenY, fee, costY, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, fee, costY, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        acquireX: stringMinus(traderAmountXAfter, traderAmountXBefore),
        costY: stringMinus(traderAmountYBefore, traderAmountYAfter),
    }
}

async function swapX2Y(testSwap, trader, tokenX, tokenY, fee, costX, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, fee, costX, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        acquireY: stringMinus(traderAmountYAfter, traderAmountYBefore),
        costX: stringMinus(traderAmountXBefore, traderAmountXAfter),
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
        [signer, miner, s1, s2, s3, s4, s5, s6, trader, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule, 50);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, 700);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);

        const TestLogPowMath = await ethers.getContractFactory('TestLogPowMath');
        logPowMath = await TestLogPowMath.deploy();

        await tokenX.mint(miner.address, '1000000000000000000000000000000');
        await tokenY.mint(miner.address, '1000000000000000000000000000000');

        await tokenX.mint(s1.address, '1000000000000000000000000000000');
        await tokenY.mint(s1.address, '1000000000000000000000000000000');
        await tokenX.mint(s2.address, '1000000000000000000000000000000');
        await tokenY.mint(s2.address, '1000000000000000000000000000000');
        await tokenX.mint(s3.address, '1000000000000000000000000000000');
        await tokenY.mint(s3.address, '1000000000000000000000000000000');
        await tokenX.mint(s4.address, '1000000000000000000000000000000');
        await tokenY.mint(s4.address, '1000000000000000000000000000000');
        await tokenX.mint(s5.address, '1000000000000000000000000000000');
        await tokenY.mint(s5.address, '1000000000000000000000000000000');
        await tokenX.mint(s6.address, '1000000000000000000000000000000');
        await tokenY.mint(s6.address, '1000000000000000000000000000000');

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
        await tokenX.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenX.connect(s1).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(s1).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenX.connect(s2).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(s2).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenX.connect(s3).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(s3).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenX.connect(s4).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(s4).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenX.connect(s5).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(s5).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenX.connect(s6).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(s6).approve(testAddLimOrder.address, '1000000000000000000000000000000');

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

    });
    
    it("start with 1.3.3, end with 1.0", async function () {

        this.timeout(1000000);
        await addLiquidity(testMint, miner, tokenX, tokenY, 3000, 0, 100, '1000000')
        await addLiquidity(testMint, miner, tokenX, tokenY, 3000, 250, 700, '1000000')

        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', 50);

        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', 250);

        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', 350);

        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', 500);
        await addLimOrderWithY(tokenX, tokenY, s2, testAddLimOrder, '200000000000000000000', 500);
        await addLimOrderWithY(tokenX, tokenY, s3, testAddLimOrder, '300000000000000000000', 500);

        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', 700);
        await addLimOrderWithY(tokenX, tokenY, s2, testAddLimOrder, '200000000000000000000', 700);
        await addLimOrderWithY(tokenX, tokenY, s3, testAddLimOrder, '300000000000000000000', 700);

        // swap1
        const acquireYAt700_1 = '200000000000000000000'
        const costXAt700_1 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), acquireYAt700_1)
        const costXAt700_WithFee_1 = amountAddFee(costXAt700_1, 3000)
        const swap1 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAt700_WithFee_1, 700)
        expect(swap1.acquireY).to.equal(acquireYAt700_1)
        expect(swap1.costX).to.equal(costXAt700_WithFee_1)

        const s1_dec_700_1 = await decLimOrderWithY(s1, testAddLimOrder, '100000000000000000000', 700, poolAddr);
        expect(s1_dec_700_1.actualDec).to.equal('0');
        expect(s1_dec_700_1.sellingReduce).to.equal('100000000000000000000')
        expect(s1_dec_700_1.sold).to.equal('100000000000000000000')
        expect(s1_dec_700_1.earn).to.equal(getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000'))

        const s3_earnRemain_1 = stringMinus(costXAt700_1, s1_dec_700_1.earn)
        const s3_dec_700_1_1 = await decLimOrderWithY(s3, testAddLimOrder, '100000000000000000000', 700, poolAddr)
        const s3SoldAt700_1 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), s3_earnRemain_1);
        expect(s3_dec_700_1_1.actualDec).to.equal('100000000000000000000');
        expect(s3_dec_700_1_1.sold).to.equal(s3SoldAt700_1)
        expect(s3_dec_700_1_1.sellingReduce).to.equal(stringAdd(s3SoldAt700_1, '100000000000000000000'))
        expect(s3_dec_700_1_1.earn).to.equal(s3_earnRemain_1)

        const s1_dec_700_1_2 = await decLimOrderWithY(s1, testAddLimOrder, '100000000000000000000', 700, poolAddr);
        expect(s1_dec_700_1_2.actualDec).to.equal('0');
        expect(s1_dec_700_1_2.sellingReduce).to.equal('0')
        expect(s1_dec_700_1_2.sold).to.equal('0')
        expect(s1_dec_700_1_2.earn).to.equal('0')

        // swap2
        const acquireYAt700_2 = '200000000000000000000'
        const costXAt700_2 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), acquireYAt700_2)
        const costXAt700_WithFee_2 = amountAddFee(costXAt700_2, 3000)
        const swap2 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAt700_WithFee_2, 700)
        expect(swap2.acquireY).to.equal(acquireYAt700_2)
        expect(swap2.costX).to.equal(costXAt700_WithFee_2)

        const s3_dec_700_2 = await decLimOrderWithY(s3, testAddLimOrder, '100000000000000000000', 700, poolAddr);
        expect(s3_dec_700_2.actualDec).to.equal('0');
        expect(s3_dec_700_2.sellingReduce).to.equal(s3_dec_700_1_1.earnAfter.sellingRemain)
        expect(s3_dec_700_2.sold).to.equal(s3_dec_700_1_1.earnAfter.sellingRemain)
        expect(s3_dec_700_2.earn).to.equal(getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), s3_dec_700_1_1.earnAfter.sellingRemain))

        const limOrder_700_2 = await getLimOrder(poolAddr, 700);
        expect(limOrder_700_2.sellingY.toString()).to.equal('100000000000000000000')

        // 3 add limorder
        await addLimOrderWithX(
            tokenX, tokenY, s4, testAddLimOrder, 
            stringAdd('100000000000000000000', getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')),
            700
        )
        await addLimOrderWithX(
            tokenX, tokenY, s5, testAddLimOrder, 
            '200000000000000000000', 
            700
        )
        await addLimOrderWithX(
            tokenX, tokenY, s6, testAddLimOrder, 
            '300000000000000000000', 
            700
        )

        await checkLimOrder(
            '600000000000000000000', 
            getSum([
                costXAt700_1,
                costXAt700_2,
                getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
            ]), 
            '0', 
            '0', '0', '0',
            undefined, '0',
            '0', '0', 
            poolAddr, 700
        )

        const s2_dec_700_3 = await decLimOrderWithY(s2, testAddLimOrder, '0', 700, poolAddr)
        expect(s2_dec_700_3.actualDec).to.equal('0')
        expect(s2_dec_700_3.sellingReduce).to.equal('200000000000000000000')
        expect(s2_dec_700_3.sold).to.equal('200000000000000000000')
        expect(s2_dec_700_3.earn).to.equal(getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '200000000000000000000'))

        const s4_uey_700_3 = await getEarnY(testAddLimOrder, poolAddr, s4.address, 700)
        expect(s4_uey_700_3.lastAccEarn).to.equal('0');
        expect(s4_uey_700_3.sellingRemain).to.equal('100000000000000000000');
        expect(s4_uey_700_3.earn).to.equal('0');
        expect(s4_uey_700_3.earnAssign).to.equal('100000000000000000000');

        // swap4
        const costX_500_700 = xInRange('1000000', 500, 700, '1.0001', true)
        const acquireY_500_700 = yInRange('1000000', 500, 700, '1.0001', false)
        const acquireLimYAt500 = '150000000000000000000'
        const costLimXAt500 = getCostXFromYAt((await logPowMath.getSqrtPrice(500)).toString(), acquireLimYAt500)
        const swap4 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            amountAddFee(costX_500_700), amountAddFee(costLimXAt500)
        ]), -1000, poolAddr);
        expect(swap4.acquireY).to.equal(getSum([acquireY_500_700, acquireLimYAt500]))

        const s1_dec_500_4 = await decLimOrderWithY(s1, testAddLimOrder, '200000000000000000000', 500, poolAddr);
        expect(s1_dec_500_4.actualDec).to.equal('0');
        expect(s1_dec_500_4.sellingReduce).to.equal('100000000000000000000')
        expect(s1_dec_500_4.sold).to.equal('100000000000000000000')
        expect(s1_dec_500_4.earn).to.equal(getEarnXFromYAt((await logPowMath.getSqrtPrice(500)).toString(), '100000000000000000000'))

        const s3_dec_500_4 = await decLimOrderWithY(s3, testAddLimOrder, '200000000000000000000', 500, poolAddr);
        const s3_earnRemain_4 = stringMinus(costLimXAt500, s1_dec_500_4.earn)
        const s3SoldAt500_4 = getCostYFromXAt((await logPowMath.getSqrtPrice(500)).toString(), s3_earnRemain_4);
        expect(s3_dec_500_4.actualDec).to.equal('200000000000000000000');
        expect(s3_dec_500_4.sellingReduce).to.equal(stringAdd('200000000000000000000', s3SoldAt500_4))
        expect(s3_dec_500_4.sold).to.equal(s3SoldAt500_4)
        expect(s3_dec_500_4.earn).to.equal(s3_earnRemain_4)

        // swap5
        const acquireLimYAt500_5 = '250000000000000000000'
        const costXAt500_5 = getCostXFromYAt((await logPowMath.getSqrtPrice(500)).toString(), acquireLimYAt500_5)
        const costXAt500_WithFee_5 = amountAddFee(costXAt500_5, 3000)
        const swap5 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAt500_WithFee_5, 500)
        expect(swap5.acquireY).to.equal(acquireLimYAt500_5)
        expect(swap5.costX).to.equal(costXAt500_WithFee_5)


        const s2_dec_500_5 = await decLimOrderWithY(s2, testAddLimOrder, '100000000000000000000', 500, poolAddr);
        expect(s2_dec_500_5.actualDec).to.equal('0');
        expect(s2_dec_500_5.sellingReduce).to.equal('200000000000000000000')
        expect(s2_dec_500_5.sold).to.equal('200000000000000000000')
        expect(s2_dec_500_5.earn).to.equal(getEarnXFromYAt((await logPowMath.getSqrtPrice(500)).toString(), '200000000000000000000'))

        const s3_dec_500_5 = await decLimOrderWithY(s3, testAddLimOrder, '100000000000000000000', 500, poolAddr);
        expect(s3_dec_500_5.actualDec).to.equal('0');
        expect(s3_dec_500_5.sellingReduce).to.equal(stringMinus('300000000000000000000', stringAdd('200000000000000000000', s3SoldAt500_4)))
        expect(s3_dec_500_5.sold).to.equal(stringMinus('100000000000000000000', s3SoldAt500_4))
        expect(s3_dec_500_5.earn).to.equal(getEarnXFromYAt((await logPowMath.getSqrtPrice(500)).toString(), s3_dec_500_5.sold))

        await checkLimOrder(
            '0', stringAdd(costXAt500_5, costLimXAt500), stringAdd(costXAt500_5, costLimXAt500),
            '0', '0', '0',
            '0', '0',
            undefined, '0', 
            poolAddr, 500)

        // swap6
        const costX_350_500 = xInRange('1000000', 350, 500, '1.0001', true)
        const acquireY_350_500 = yInRange('1000000', 350, 500, '1.0001', false)
        const acquireLimYAt350 = '100000000000000000000'
        const costLimXAt350 = getCostXFromYAt((await logPowMath.getSqrtPrice(350)).toString(), acquireLimYAt350)
        const costX_320_350 = xInRange('1000000', 320, 350, '1.0001', true)
        const acquireY_320_350 = yInRange('1000000', 320, 350, '1.0001', false)
        const swap6 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            amountAddFee(costX_350_500), amountAddFee(costLimXAt350), amountAddFee(costX_320_350)
        ]), -1000, poolAddr);
        expect(swap6.acquireY).to.equal(getSum([acquireY_350_500, acquireLimYAt350, acquireY_320_350]))

        const state6 = await getState(pool)
        expect(state6.currentPoint).to.equal('319')
        expect(state6.liquidity).to.equal('1000000')
        expect(state6.liquidityX).to.equal('0')

        const s1_dec_350_6 = await decLimOrderWithY(s1, testAddLimOrder, '100000000000000000000', 350, poolAddr);
        expect(s1_dec_350_6.actualDec).to.equal('0');
        expect(s1_dec_350_6.sellingReduce).to.equal('100000000000000000000')
        expect(s1_dec_350_6.sold).to.equal('100000000000000000000')
        expect(s1_dec_350_6.earn).to.equal(getEarnXFromYAt((await logPowMath.getSqrtPrice(350)).toString(), '100000000000000000000'))
        await checkLimOrder(
            '0', costLimXAt350, costLimXAt350,
            '0', '0', '0',
            '0', '0',
            undefined, undefined, 
            poolAddr, 350)

        // swap7
        const acquireX_320_370 = xInRange('1000000', 320, 370, '1.0001', false)
        const costY_320_370 = yInRange('1000000', 320, 370, '1.0001', true)
        const swap7 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, getSum([
            amountAddFee(costY_320_370)
        ]), 1000, poolAddr);
        expect(swap7.acquireX).to.equal(acquireX_320_370)
        const state7 = await getState(pool)
        expect(state7.currentPoint).to.equal('370')
        expect(state7.liquidity).to.equal('1000000')
        expect(state7.liquidityX).to.equal('1000000')

        // swap8
        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', 350);
        
        const s1_dec_350_8 = await decLimOrderWithY(s1, testAddLimOrder, '100000000000000000000', 350, poolAddr);
        expect(s1_dec_350_8.actualDec).to.equal('100000000000000000000');
        expect(s1_dec_350_8.sellingReduce).to.equal('100000000000000000000')
        expect(s1_dec_350_8.sold).to.equal('0')
        expect(s1_dec_350_8.earn).to.equal('0')

        await checkLimOrder(
            '0', costLimXAt350, costLimXAt350,
            '0', '0', '0',
            '0', '0',
            undefined, undefined, 
            poolAddr, 350)

        const acquireY_250_370 = yInRange('1000000', 250, 370, '1.0001', false);
        const costX_250_370 = xInRange('1000000', 250, 370, '1.0001', true);
        const acquireLimYAt250 = '100000000000000000000'
        const costLimXAt250 = getCostXFromYAt((await logPowMath.getSqrtPrice(250)).toString(), acquireLimYAt250)
        const swap8 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, '1000000000000000000000000', 150, poolAddr);
        expect(swap8.costX).to.equal(getSum([
            amountAddFee(costX_250_370), amountAddFee(costLimXAt250)
        ]))
        expect(swap8.acquireY).to.equal(getSum([acquireY_250_370, acquireLimYAt250]))

        const state8 = await getState(pool)
        expect(state8.currentPoint).to.equal('150')
        expect(state8.liquidity).to.equal('0')
        expect(state8.liquidityX).to.equal('0')
        // swap9
        const acquireX_250_370 = xInRange('1000000', 250, 370, '1.0001', false)
        const costY_250_370 = yInRange('1000000', 250, 370, '1.0001', true)
        const swap9 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, '1000000000000000000000000', 370, poolAddr);
        expect(swap9.acquireX).to.equal(acquireX_250_370)
        expect(swap9.costY).to.equal(amountAddFee(costY_250_370));
        const state9 = await getState(pool)
        expect(state9.currentPoint).to.equal('370')
        expect(state9.liquidity).to.equal('1000000')
        expect(state9.liquidityX).to.equal('1000000')


        // swap10
        const acquireY_250_370_10 = yInRange('1000000', 250, 370, '1.0001', false)
        const costX_250_370_10 = xInRange('1000000', 250, 370, '1.0001', true)
        const acquireY_50_100 = yInRange('1000000', 50, 100, '1.0001', false)
        const costX_50_100 = xInRange('1000000', 50, 100, '1.0001', true)

        const acquireLimYAt50 = '50000000000000000000'
        const costLimXAt50 = getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), acquireLimYAt50)
        
        const swap10 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, getSum([
            amountAddFee(costX_250_370_10), amountAddFee(costX_50_100), amountAddFee(costLimXAt50)
        ]), -1000, poolAddr);
        expect(swap10.costX).to.equal(getSum([
            amountAddFee(costX_250_370_10), amountAddFee(costX_50_100), amountAddFee(costLimXAt50)
        ]))
        expect(swap10.acquireY).to.equal(getSum([acquireY_250_370_10, acquireY_50_100, acquireLimYAt50]))

        await checkLimOrder(
            '0', costLimXAt50, '0',
            '50000000000000000000', '0', '0',
            costLimXAt50, '0', 
            '0', '0',
            poolAddr, 50)

        const s1_dec_50_10 = await decLimOrderWithY(s1, testAddLimOrder, '20000000000000000000', 50, poolAddr);
        expect(s1_dec_50_10.actualDec).to.equal('20000000000000000000');
        expect(s1_dec_50_10.sellingReduce).to.equal(stringAdd('20000000000000000000', getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), costLimXAt50)))
        expect(s1_dec_50_10.sold).to.equal(getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), costLimXAt50))
        expect(s1_dec_50_10.earn).to.equal(costLimXAt50)

        const s1_uex_50_10 = await getEarnX(testAddLimOrder, poolAddr, s1.address, 50)
        expect(s1_uex_50_10.sellingRemain).to.equal(stringMinus('100000000000000000000', s1_dec_50_10.sellingReduce));
        expect(s1_uex_50_10.earn).to.equal(
            costLimXAt50
        );
        expect(s1_uex_50_10.earnAssign).to.equal('0');
        // 11 add limorder
        await addLimOrderWithX(
            tokenX, tokenY, s4, testAddLimOrder, 
            stringAdd('100000000000000000000', getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')),
            50
        )
        await addLimOrderWithX(
            tokenX, tokenY, s5, testAddLimOrder, 
            '200000000000000000000', 
            50
        )
        await addLimOrderWithX(
            tokenX, tokenY, s6, testAddLimOrder, 
            '300000000000000000000', 
            50
        )

        const s4_uey_50_3 = await getEarnY(testAddLimOrder, poolAddr, s4.address, 50)
        expect(s4_uey_50_3.lastAccEarn).to.equal('0');
        expect(s4_uey_50_3.sellingRemain).to.equal('100000000000000000000');
        expect(s4_uey_50_3.earn).to.equal('0');
        expect(s4_uey_50_3.earnAssign).to.equal('30000000000000000000');

        // swap12
        await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, '100000000000000000000000000', 25)

        const state12 = await getState(pool)
        expect(state12.currentPoint).to.equal('25')
        expect(state12.liquidity).to.equal('1000000')
        expect(state12.liquidityX).to.equal('1000000')

        // swap13
        const acquireX_25_50 = xInRange('1000000', 25, 50, '1.0001', false)
        const costY_25_50 = yInRange('1000000', 25, 50, '1.0001', true)

        const acquireXAt50_13 = '200000000000000000000'
        const costYAt50_13 = getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), acquireXAt50_13)
        const swap13 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, getSum([
            amountAddFee(costY_25_50), amountAddFee(costYAt50_13)
        ]), 700)
        expect(swap13.costY).to.equal(getSum([
            amountAddFee(costY_25_50), amountAddFee(costYAt50_13)
        ]))
        expect(swap13.acquireX).to.equal(getSum([
            acquireX_25_50, acquireXAt50_13
        ]))

        const s4_dec_50_13 = await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 50, poolAddr);
        expect(s4_dec_50_13.actualDec).to.equal('0');
        expect(s4_dec_50_13.sellingReduce).to.equal('100000000000000000000')
        expect(s4_dec_50_13.sold).to.equal('100000000000000000000')
        expect(s4_dec_50_13.earn).to.equal(getEarnYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '100000000000000000000'))


        const s6_earnRemain_13 = stringMinus(costYAt50_13, s4_dec_50_13.earn)
        const s6_dec_50_13 = await decLimOrderWithX(s6, testAddLimOrder, '100000000000000000000', 50, poolAddr)
        const s6SoldAt50_13 = getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), s6_earnRemain_13);
        expect(s6_dec_50_13.actualDec).to.equal('100000000000000000000');
        expect(s6_dec_50_13.sold).to.equal(s6SoldAt50_13)
        expect(s6_dec_50_13.sellingReduce).to.equal(stringAdd(s6SoldAt50_13, '100000000000000000000'))
        expect(s6_dec_50_13.earn).to.equal(s6_earnRemain_13)

        await checkLimOrder(
            '300000000000000000000', 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]),

            '0', costYAt50_13, '0',
            
            '0', '0', 

            undefined, '0',
            
            poolAddr, 50
        )

        // swap14
        const acquireXAt50_14 = '200000000000000000000'
        const costYAt50_14 = getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), acquireXAt50_14)
        const swap14 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, amountAddFee(costYAt50_14), 1000)
        expect(swap14.acquireX).to.equal(acquireXAt50_14)
        expect(swap14.costY).to.equal(amountAddFee(costYAt50_14))


        await checkLimOrder(
            '100000000000000000000', 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 

            '0', 
            getSum([
                costYAt50_13,
                costYAt50_14
            ]),
            '0', 
            
            '0', costYAt50_14, 
            undefined, '0',
            
            poolAddr, 50
        )

        const s6_dec_50_14 = await decLimOrderWithX(s6, testAddLimOrder, '100000000000000000000', 50, poolAddr);
        expect(s6_dec_50_14.actualDec).to.equal('0');
        expect(s6_dec_50_14.sellingReduce).to.equal(s6_dec_50_13.earnAfter.sellingRemain)
        expect(s6_dec_50_14.sold).to.equal(s6_dec_50_13.earnAfter.sellingRemain)
        expect(s6_dec_50_14.earn).to.equal(getEarnYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), s6_dec_50_13.earnAfter.sellingRemain))


        await checkLimOrder(
            '100000000000000000000', 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 

            '0', 
            getSum([
                costYAt50_13,
                costYAt50_14
            ]), 
            '0',
            
            '0', 
            stringMinus(costYAt50_14, s6_dec_50_14.earn), 

            undefined,
            '0',
            
            poolAddr, 50
        )

        const limOrder_50_14 = await getLimOrder(poolAddr, 50);
        expect(limOrder_50_14.sellingX.toString()).to.equal('100000000000000000000')

        // 15 add limorder
        await addLimOrderWithY(
            tokenX, tokenY, s1, testAddLimOrder, 
            stringAdd('100000000000000000000', getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '100000000000000000000')),
            50
        )

        await checkLimOrder(
            '0', 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 

            '100000000000000000000', 
            getSum([
                costYAt50_13,
                costYAt50_14,
                getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '100000000000000000000')
            ]), 
            '0',
            
            '0', 
            stringMinus(stringAdd(getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '100000000000000000000'), costYAt50_14), s6_dec_50_14.earn), 

            undefined,
            '0',

            poolAddr, 50
        );

        const s5_dec_50_14 = await decLimOrderWithX(s5, testAddLimOrder, '100000000000000000000', 50, poolAddr);
        expect(s5_dec_50_14.actualDec).to.equal('0');
        expect(s5_dec_50_14.sellingReduce).to.equal('200000000000000000000')
        expect(s5_dec_50_14.sold).to.equal('200000000000000000000')
        expect(s5_dec_50_14.earn).to.equal(getEarnYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '200000000000000000000'))

        await checkLimOrder(
            '0', 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 
            getSum([
                costLimXAt50,
                getCostXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), '30000000000000000000')
            ]), 

            '100000000000000000000', 
            getSum([
                costYAt50_13,
                costYAt50_14,
                getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '100000000000000000000')
            ]), 
            '0',
            
            '0', 
            stringMinus(
                stringMinus(stringAdd(getCostYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '100000000000000000000'), costYAt50_14), s6_dec_50_14.earn), 
                getEarnYFromXAt((await logPowMath.getSqrtPrice(50)).toString(), '200000000000000000000')
            ),

            undefined, '0',

            poolAddr, 50
        );

        const s1_uex_50_15 = await getEarnX(testAddLimOrder, poolAddr, s1.address, 50)
        expect(s1_uex_50_15.sellingRemain).to.equal('100000000000000000000');
        expect(s1_uex_50_15.earn).to.equal(stringAdd(
            costLimXAt50,
            getEarnXFromYAt((await logPowMath.getSqrtPrice(50)).toString(), s1_uex_50_10.sellingRemain))
        );
        expect(s1_uex_50_15.earnAssign).to.equal('100000000000000000000');

        // swap16

        await addLimOrderWithX(tokenX, tokenY, s4, testAddLimOrder, '200000000000000000000', 250, poolAddr)
        await addLimOrderWithX(tokenX, tokenY, s4, testAddLimOrder, '200000000000000000000', 300, poolAddr)
        await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 250, poolAddr);
        await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 300, poolAddr);
        await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 250, poolAddr);
        await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 300, poolAddr);

        const costY_50_100 = yInRange('1000000', 50, 100, '1.0001', true)
        const acquireX_50_100 = xInRange('1000000', 50, 100, '1.0001', false)
        const costY_250_700 = yInRange('1000000', 250, 700, '1.0001', true)
        const acquireX_250_700 = xInRange('1000000', 250, 700, '1.0001', false)

        const swap16 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, 
            '1000000000000000000', 700);
        expect(swap16.acquireX).to.equal(getSum([acquireX_50_100, acquireX_250_700]))
        expect(swap16.costY).to.equal(getSum([
            amountAddFee(costY_50_100), 
            amountAddFee(costY_250_700)
        ]))

        // swap17
        const acquireXAt700_17 = '200000000000000000000'
        const costYAt700_17 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), acquireXAt700_17)
        const swap17 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, amountAddFee(costYAt700_17), 7000)
        expect(swap17.acquireX).to.equal(acquireXAt700_17)
        expect(swap17.costY).to.equal(amountAddFee(costYAt700_17))

        const s4_dec_700_17 = await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 700, poolAddr);
        expect(s4_dec_700_17.actualDec).to.equal('0');
        expect(s4_dec_700_17.sellingReduce).to.equal('100000000000000000000')
        expect(s4_dec_700_17.sold).to.equal('100000000000000000000')
        expect(s4_dec_700_17.earn).to.equal(getEarnYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000'))

        const s6_earnRemain_17 = stringMinus(costYAt700_17, s4_dec_700_17.earn)
        const s6_dec_700_17 = await decLimOrderWithX(s6, testAddLimOrder, '100000000000000000000', 700, poolAddr)
        const s6SoldAt700_17 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), s6_earnRemain_17);
        expect(s6_dec_700_17.actualDec).to.equal('100000000000000000000');
        expect(s6_dec_700_17.sold).to.equal(s6SoldAt700_17)
        expect(s6_dec_700_17.sellingReduce).to.equal(stringAdd(s6SoldAt700_17, '100000000000000000000'))
        expect(s6_dec_700_17.earn).to.equal(s6_earnRemain_17)

        const s4_dec_700_17_2 = await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 700, poolAddr);
        expect(s4_dec_700_17_2.actualDec).to.equal('0');
        expect(s4_dec_700_17_2.sellingReduce).to.equal('0')
        expect(s4_dec_700_17_2.sold).to.equal('0')
        expect(s4_dec_700_17_2.earn).to.equal('0')

        // swap18
        const acquireXAt700_18 = '200000000000000000000'
        const costYAt700_18 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), acquireXAt700_18)
        const swap18 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, amountAddFee(costYAt700_18), 701)
        expect(swap18.acquireX).to.equal(acquireXAt700_18)
        expect(swap18.costY).to.equal(amountAddFee(costYAt700_18))

        const s6_dec_700_18 = await decLimOrderWithX(s6, testAddLimOrder, '100000000000000000000', 700, poolAddr);
        expect(s6_dec_700_18.actualDec).to.equal('0');
        expect(s6_dec_700_18.sellingReduce).to.equal(s6_dec_700_17.earnAfter.sellingRemain)
        expect(s6_dec_700_18.sold).to.equal(s6_dec_700_17.earnAfter.sellingRemain)
        expect(s6_dec_700_18.earn).to.equal(getEarnYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), s6_dec_700_17.earnAfter.sellingRemain))

        const limOrder_700_18 = await getLimOrder(poolAddr, 700);
        expect(limOrder_700_18.sellingX.toString()).to.equal('100000000000000000000')

        // 19 add limorder
        console.log('--------------------')
        await addLimOrderWithY(
            tokenX, tokenY, s1, testAddLimOrder, 
            stringAdd('100000000000000000000', getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')),
            700
        )

        console.log('--------------------')
        const s5_dec_700_18 = await decLimOrderWithX(s5, testAddLimOrder, '0', 700, poolAddr)
        expect(s5_dec_700_18.actualDec).to.equal('0')
        expect(s5_dec_700_18.sellingReduce).to.equal('200000000000000000000')
        expect(s5_dec_700_18.sold).to.equal('200000000000000000000')
        expect(s5_dec_700_18.earn).to.equal(getEarnYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '200000000000000000000'))


        const s1_uey_700_18 = await getEarnX(testAddLimOrder, poolAddr, s1.address, 700)
        console.log('s1_uey_700_18: ', s1_uey_700_18)
        expect(s1_uey_700_18.sellingRemain).to.equal('100000000000000000000');
        expect(s1_uey_700_18.earn).to.equal(s1_dec_700_1.earn);
        expect(s1_uey_700_18.earnAssign).to.equal('100000000000000000000');

    });



});