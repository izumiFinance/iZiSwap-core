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

function minusString(a) {
    return '-' + a
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

function convertUserEarnFromBC(userEarnBC) {
    return {
        lastAccEarn: userEarnBC.lastAccEarn.toString(),
        sellingRemain: userEarnBC.sellingRemain.toString(),
        sellingDesc: userEarnBC.sellingDesc.toString(),
        earn: userEarnBC.earn.toString(),
        earnAssign: userEarnBC.earnAssign.toString(),
        legacyEarn: userEarnBC.legacyEarn.toString()
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
    const legacyEarn = stringMinus(earnAfter.legacyEarn, earnBefore.legacyEarn)
    const sold = stringMinus(sellingReduce, actualDec)
    return {
        earnBefore,
        earnAfter,
        sellingReduce,
        actualDec,
        earn,
        legacyEarn,
        sold
    }
}

async function addLimOrderWithYReturnDelta(tokenX, tokenY, seller, testAddLimOrder, amountY, point, poolAddr) {

    await tokenY.transfer(seller.address, amountY);
    await tokenY.connect(seller).approve(testAddLimOrder.address, amountY);
    const earnBefore = await getEarnX(testAddLimOrder, poolAddr, seller.address, point)
    await testAddLimOrder.connect(seller).addLimOrderWithY(
        tokenX.address, tokenY.address, 3000, point, amountY
    );
    const earnAfter = await getEarnX(testAddLimOrder, poolAddr, seller.address, point)
    const earn = stringMinus(earnAfter.earn, earnBefore.earn)
    const legacyEarn = stringMinus(earnAfter.legacyEarn, earnBefore.legacyEarn)
    return {
        earnBefore,
        earnAfter,
        earn,
        legacyEarn,
    }
}

async function addLimOrderWithXReturnDelta(tokenX, tokenY, seller, testAddLimOrder, amountX, point, poolAddr) {

    await tokenX.transfer(seller.address, amountX);
    await tokenX.connect(seller).approve(testAddLimOrder.address, amountX);
    const earnBefore = await getEarnY(testAddLimOrder, poolAddr, seller.address, point)
    await testAddLimOrder.connect(seller).addLimOrderWithX(
        tokenX.address, tokenY.address, 3000, point, amountX
    );
    const earnAfter = await getEarnY(testAddLimOrder, poolAddr, seller.address, point)
    const earn = stringMinus(earnAfter.earn, earnBefore.earn)
    const legacyEarn = stringMinus(earnAfter.legacyEarn, earnBefore.legacyEarn)
    return {
        earnBefore,
        earnAfter,
        earn,
        legacyEarn,
    }
}
async function addLimOrderWithY(tokenX, tokenY, seller, testAddLimOrder, amountY, point) {
    await tokenY.transfer(seller.address, amountY);
    await tokenY.connect(seller).approve(testAddLimOrder.address, amountY);
    await testAddLimOrder.connect(seller).addLimOrderWithY(
        tokenX.address, tokenY.address, 3000, point, amountY
    );
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
    const legacyEarn = stringMinus(earnAfter.legacyEarn, earnBefore.legacyEarn)
    const sold = stringMinus(sellingReduce, actualDec)
    return {
        earnBefore,
        earnAfter,
        sellingReduce,
        actualDec,
        earn,
        legacyEarn,
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
    
    it("", async function () {

        this.timeout(1000000);

        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', 700)
        await addLimOrderWithY(tokenX, tokenY, s2, testAddLimOrder, '200000000000000000000', 700)
        await addLimOrderWithY(tokenX, tokenY, s3, testAddLimOrder, '300000000000000000000', 700)

        // swap1
        const acquireYAt700_1 = '200000000000000000000'
        const costXAt700_1 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), acquireYAt700_1)
        const costXAt700_WithFee_1 = amountAddFee(costXAt700_1, 3000)
        const swap1 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 3000, acquireYAt700_1, 700)
        expect(swap1.acquireY).to.equal(acquireYAt700_1)
        expect(swap1.costX).to.equal(costXAt700_WithFee_1)

        await checkLimOrder(
            '0', costXAt700_1, '0',
            '400000000000000000000', '0', '0',
            costXAt700_1, '0',
            '0', '0', 
            poolAddr, 700)
        
        const s3_dec_700_1 = await decLimOrderWithY(s3, testAddLimOrder, '300000000000000000000', 700, poolAddr)
        const s3_expect_soldY_1 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), costXAt700_1)
        const s3_expect_actualDec_1 = stringMinus('300000000000000000000', s3_expect_soldY_1)

        expect(s3_dec_700_1.actualDec).to.equal(s3_expect_actualDec_1)
        expect(s3_dec_700_1.sold).to.equal(s3_expect_soldY_1)
        expect(s3_dec_700_1.earn).to.equal(costXAt700_1)

        console.log('s3_dec_700_1.actualDec: ', s3_dec_700_1.actualDec)
        const acquireYAt700_2 = stringMinus('400000000000000000000', s3_dec_700_1.actualDec)
        const costXAt700_2 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), acquireYAt700_2)
        const swap2 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 3000, acquireYAt700_2, 700)

        await checkLimOrder(
            '0', stringAdd(costXAt700_1, costXAt700_2), stringAdd(costXAt700_1, costXAt700_2),
            '0', '0', '0',
            '0', '0',
            costXAt700_2, '0', 
            poolAddr, 700)
        
        
        await addLimOrderWithY(tokenX, tokenY, s3, testAddLimOrder, '100000000000000000000', 700)

        const swap3 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 3000, '100000000000000000000', 700)
        const costXAt700_3 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')

        await checkLimOrder(
            '0', getSum([costXAt700_1, costXAt700_2, costXAt700_3]), getSum([costXAt700_1, costXAt700_2, costXAt700_3]),
            '0', '0', '0',
            '0', '0',
            getSum([costXAt700_2, costXAt700_3]), '0', 
            poolAddr, 700)

        await addLimOrderWithY(tokenX, tokenY, s4, testAddLimOrder, '100000000000000000000', 700)
        await addLimOrderWithY(tokenX, tokenY, s5, testAddLimOrder, '100000000000000000000', 700)

        const costXAt700_4 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        const costXAt700_WithFee_4 = amountAddFee(costXAt700_4, 3000)
        const swap4 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 3000, '100000000000000000000', 700)


        await checkLimOrder(
            '0', 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3, costXAt700_4]), 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3]),
            '100000000000000000000', '0', '0',
            costXAt700_4, '0',
            getSum([costXAt700_2, costXAt700_3]), '0', 
            poolAddr, 700)
        
        const s4_dec_700_4 = await decLimOrderWithY(s4, testAddLimOrder, '100000000000000000000', 700, poolAddr)
        const s4_expect_earnX_4 = getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        expect(s4_dec_700_4.earn).to.equal(s4_expect_earnX_4)
        expect(s4_dec_700_4.actualDec).to.equal('0')
        expect(s4_dec_700_4.sold).to.equal('100000000000000000000')

        const earnRemainAfterS4Dec_4 = stringMinus(costXAt700_4, s4_expect_earnX_4)

        await checkLimOrder(
            '0', 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3, costXAt700_4]), 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3]),
            '100000000000000000000', '0', '0',
            earnRemainAfterS4Dec_4, '0',
            getSum([costXAt700_2, costXAt700_3]), '0', 
            poolAddr, 700)
        
        
        const s5_dec_700_4 = await decLimOrderWithY(s5, testAddLimOrder, '0', 700, poolAddr)
        const s5_expect_earnX_4 = earnRemainAfterS4Dec_4
        expect(s5_dec_700_4.earn).to.equal(s5_expect_earnX_4)
        expect(s5_dec_700_4.actualDec).to.equal('0')
        const s5_expect_sold_4 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), s5_expect_earnX_4)
        expect(s5_dec_700_4.sold).to.equal(s5_expect_sold_4)

        const s5_uex_4 = await getEarnX(testAddLimOrder, poolAddr, s5.address, 700)
        expect(s5_uex_4.earn).to.equal(s5_expect_earnX_4)
        expect(s5_uex_4.sellingRemain).to.equal(stringMinus('100000000000000000000', s5_dec_700_4.sold))
        expect(s5_uex_4.sellingDesc).to.equal('0')

        await checkLimOrder(
            '0', 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3, costXAt700_4]), 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3]),
            '100000000000000000000', '0', '0',
            '0', '0',
            getSum([costXAt700_2, costXAt700_3]), '0', 
            poolAddr, 700)
        
        const s3_add_700_4 = await addLimOrderWithYReturnDelta(
            tokenX, tokenY, s3, testAddLimOrder, 
            '200000000000000000000', 700, poolAddr)
        // const s3_dec_700_4 = await decLimOrderWithY(s3, testAddLimOrder, '0', 700, poolAddr)
        const s3_expect_earnX_4 = getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        expect(s3_add_700_4.earn).to.equal('0')
        expect(s3_add_700_4.legacyEarn).to.equal(s3_expect_earnX_4)
        expect(s3_add_700_4.earnAfter.sellingRemain).to.equal('200000000000000000000')
        expect(s3_add_700_4.earnAfter.sellingDesc).to.equal(s3_dec_700_1.actualDec)

        const s1_dec_700_4 = await decLimOrderWithY(s1, testAddLimOrder, '0', 700, poolAddr)
        const s1_expect_earnX_4 = getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        expect(s1_dec_700_4.earn).to.equal('0')
        expect(s1_dec_700_4.legacyEarn).to.equal(s1_expect_earnX_4)
        expect(s1_dec_700_4.actualDec).to.equal('0')
        expect(s1_dec_700_4.sold).to.equal('100000000000000000000')

        const s2_dec_700_4 = await decLimOrderWithY(s2, testAddLimOrder, '0', 700, poolAddr)
        const s2_expect_earnX_4 = getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '200000000000000000000')
        expect(s2_dec_700_4.earn).to.equal('0')
        expect(s2_dec_700_4.legacyEarn).to.equal(s2_expect_earnX_4)
        expect(s2_dec_700_4.actualDec).to.equal('0')
        expect(s2_dec_700_4.sold).to.equal('200000000000000000000')

        const s2_dec_700_4_2nd = await decLimOrderWithY(s2, testAddLimOrder, '200000000000000000000', 700, poolAddr)
        expect(s2_dec_700_4_2nd.earn).to.equal('0')
        expect(s2_dec_700_4_2nd.legacyEarn).to.equal('0')
        expect(s2_dec_700_4_2nd.actualDec).to.equal('0')
        expect(s2_dec_700_4_2nd.sold).to.equal('0')

        const legacyEarnRemain_4 = getSum([costXAt700_2, costXAt700_3, '-' + getSum([s1_dec_700_4.legacyEarn, s2_dec_700_4.legacyEarn, s3_add_700_4.legacyEarn])]);

        await checkLimOrder(
            '0', 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3, costXAt700_4]), 
            getSum([costXAt700_1, costXAt700_2, costXAt700_3]),
            '300000000000000000000', '0', '0',
            '0', '0',
            legacyEarnRemain_4, '0', 
            poolAddr, 700)
        
        // // expect(legacyEarnRemain_5)
        // // console.log('legacyEarnRemain_5: ', legacyEarnRemain_5)
            
        // // const s1_expect_earnX_2 = getEarnXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        // // await checkLimOrder(
        // //     '0', stringAdd(costXAt700_1, costXAt700_2), stringAdd(costXAt700_1, costXAt700_2),
        // //     '200000000000000000000', '0', '0',
        // //     '0', '0',
        // //     stringMinus(costXAt700_2, s1_expect_earnX_2), '0', 
        // //     poolAddr, 700)
        
        // // const s1_uex_2 = await getEarnX(testAddLimOrder, poolAddr, s1.address, 700)
        // // expect(s1_uex_2.earn).to.equal(s1_expect_earnX_2)
        // // expect(s1_uex_2.sellingRemain).to.equal('100000000000000000000')
        // // expect(s1_uex_2.sellingDesc).to.equal('0')

        // // const s2_dec_700_2 = await decLimOrderWithY(s2, testAddLimOrder, '100000000000000000000', 700, poolAddr)

        await addLimOrderWithX(
            tokenX, tokenY, s1, testAddLimOrder, 
            stringAdd('100000000000000000000', getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '300000000000000000000')),
            700
        )
        const earnXRemain = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '300000000000000000000')
        const accEarnX = getSum([costXAt700_1, costXAt700_2, costXAt700_3, costXAt700_4, earnXRemain])
        const legacyAccEarnX = getSum([costXAt700_1, costXAt700_2, costXAt700_3])
        await addLimOrderWithX(tokenX, tokenY, s2, testAddLimOrder, '200000000000000000000', 700)
        await addLimOrderWithX(tokenX, tokenY, s3, testAddLimOrder, '300000000000000000000', 700)

        // swap5
        const acquireXAt700_5 = '200000000000000000000'
        const costYAt700_5 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), acquireXAt700_5)
        const costYAt700_WithFee_5 = amountAddFee(costYAt700_5, 3000)
        const swap5 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, acquireXAt700_5, 701)
        expect(swap5.acquireX).to.equal(acquireXAt700_5)
        expect(swap5.costY).to.equal(costYAt700_WithFee_5)

        await checkLimOrder(
            '400000000000000000000', 
            accEarnX, 
            legacyAccEarnX,

            '0', costYAt700_5, '0',

            earnXRemain, costYAt700_5,

            legacyEarnRemain_4, '0', 
            poolAddr, 700)
        
       
        const s3_dec_700_5 = await decLimOrderWithX(s3, testAddLimOrder, '300000000000000000000', 700, poolAddr)
        const s3_expect_soldX_5 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), costYAt700_5)
        const s3_expect_actualDec_5 = stringMinus('300000000000000000000', s3_expect_soldX_5)

        expect(s3_dec_700_5.actualDec).to.equal(s3_expect_actualDec_5)
        expect(s3_dec_700_5.sold).to.equal(s3_expect_soldX_5)
        expect(s3_dec_700_5.earn).to.equal(costYAt700_5)

        // console.log('s3_dec_700_5.actualDec: ', s3_dec_700_5.actualDec)
        const acquireXAt700_6 = stringMinus('400000000000000000000', s3_dec_700_5.actualDec)
        const costYAt700_6 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), acquireXAt700_6)
        const swap6 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, acquireXAt700_6, 701)

        await checkLimOrder(
            '0', 
            accEarnX, 
            legacyAccEarnX,

            '0', stringAdd(costYAt700_5, costYAt700_6), stringAdd(costYAt700_5, costYAt700_6),

            earnXRemain, '0',

            legacyEarnRemain_4, costYAt700_6, 
            poolAddr, 700)        
        
        await addLimOrderWithY(tokenX, tokenY, s6, testAddLimOrder, '100000000000000000000', 700)
        await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, '100000000000000000000000', 699)
        const earnXBefore7 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        
        await addLimOrderWithX(tokenX, tokenY, s3, testAddLimOrder, '100000000000000000000', 700)

        const swap7 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, '100000000000000000000', 701)
        const costYAt700_7 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')

        await checkLimOrder(
            '0', 
            getSum([accEarnX, earnXBefore7]), 
            getSum([accEarnX, earnXBefore7]),

            '0', getSum([costYAt700_5, costYAt700_6, costYAt700_7]), getSum([costYAt700_5, costYAt700_6, costYAt700_7]),

            '0', '0',

            getSum([legacyEarnRemain_4, earnXRemain, earnXBefore7]), getSum([costYAt700_6, costYAt700_7]), 
            poolAddr, 700)      

        await addLimOrderWithY(tokenX, tokenY, s6, testAddLimOrder, '100000000000000000000', 700)
        await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 3000, '100000000000000000000', 699)
        const earnXBefore8 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')

        await addLimOrderWithX(tokenX, tokenY, s4, testAddLimOrder, '100000000000000000000', 700)
        await addLimOrderWithX(tokenX, tokenY, s5, testAddLimOrder, '100000000000000000000', 700)

        const costYAt700_8 = getCostYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        const costYAt700_WithFee_8 = amountAddFee(costYAt700_8, 3000)
        const swap8 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, '100000000000000000000', 701)

        await checkLimOrder(
            '100000000000000000000', 
            getSum([accEarnX, earnXBefore7, earnXBefore8]), 
            getSum([accEarnX, earnXBefore7, earnXBefore8]),

            '0', getSum([costYAt700_5, costYAt700_6, costYAt700_7, costYAt700_8]), getSum([costYAt700_5, costYAt700_6, costYAt700_7]),

            '0', costYAt700_8,

            undefined, getSum([costYAt700_6, costYAt700_7]), 
            poolAddr, 700)  

        
        const s4_dec_700_8 = await decLimOrderWithX(s4, testAddLimOrder, '100000000000000000000', 700, poolAddr)
        const s4_expect_earnY_8 = getEarnYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        expect(s4_dec_700_8.earn).to.equal(s4_expect_earnY_8)
        expect(s4_dec_700_8.actualDec).to.equal('0')
        expect(s4_dec_700_8.sold).to.equal('100000000000000000000')

        const earnRemainAfterS4Dec_8 = stringMinus(costYAt700_8, s4_expect_earnY_8)

        await checkLimOrder(
            '100000000000000000000', 
            getSum([accEarnX, earnXBefore7, earnXBefore8]), 
            getSum([accEarnX, earnXBefore7, earnXBefore8]),

            '0', getSum([costYAt700_5, costYAt700_6, costYAt700_7, costYAt700_8]), getSum([costYAt700_5, costYAt700_6, costYAt700_7]),

            '0', earnRemainAfterS4Dec_8,

            undefined, getSum([costYAt700_6, costYAt700_7]), 
            poolAddr, 700)  

        const s5_dec_700_8 = await decLimOrderWithX(s5, testAddLimOrder, '0', 700, poolAddr)
        const s5_expect_earnY_8 = earnRemainAfterS4Dec_8
        expect(s5_dec_700_8.earn).to.equal(s5_expect_earnY_8)
        expect(s5_dec_700_8.actualDec).to.equal('0')
        const s5_expect_sold_8 = getCostXFromYAt((await logPowMath.getSqrtPrice(700)).toString(), s5_expect_earnY_8)
        expect(s5_dec_700_8.sold).to.equal(s5_expect_sold_8)

        const s5_uex_8 = await getEarnY(testAddLimOrder, poolAddr, s5.address, 700)
        expect(s5_uex_8.earn).to.equal(s5_expect_earnY_8)
        expect(s5_uex_8.sellingRemain).to.equal(stringMinus('100000000000000000000', s5_dec_700_8.sold))
        expect(s5_uex_8.sellingDesc).to.equal('0')

        await checkLimOrder(
            '100000000000000000000', 
            getSum([accEarnX, earnXBefore7, earnXBefore8]), 
            getSum([accEarnX, earnXBefore7, earnXBefore8]),

            '0', 
            getSum([costYAt700_5, costYAt700_6, costYAt700_7, costYAt700_8]), 
            getSum([costYAt700_5, costYAt700_6, costYAt700_7]),

            '0', '0',

            undefined, getSum([costYAt700_6, costYAt700_7]), 
            poolAddr, 700)  
        
        const s3_add_700_8 = await addLimOrderWithXReturnDelta(
            tokenX, tokenY, s3, testAddLimOrder, 
            '200000000000000000000', 700, poolAddr)
        // const s3_dec_700_4 = await decLimOrderWithY(s3, testAddLimOrder, '0', 700, poolAddr)
        const s3_expect_earnY_8 = getEarnYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        expect(s3_add_700_8.earn).to.equal('0')
        expect(s3_add_700_8.legacyEarn).to.equal(s3_expect_earnY_8)
        expect(s3_add_700_8.earnAfter.sellingRemain).to.equal('200000000000000000000')
        expect(s3_add_700_8.earnAfter.sellingDesc).to.equal(s3_dec_700_5.actualDec)

        const s1_dec_700_8 = await decLimOrderWithX(s1, testAddLimOrder, '0', 700, poolAddr)
        const s1_expect_earnY_8 = getEarnYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '100000000000000000000')
        expect(s1_dec_700_8.earn).to.equal('0')
        expect(s1_dec_700_8.legacyEarn).to.equal(s1_expect_earnY_8)
        expect(s1_dec_700_8.actualDec).to.equal('0')
        expect(s1_dec_700_8.sold).to.equal('100000000000000000000')

        const s2_dec_700_8 = await decLimOrderWithX(s2, testAddLimOrder, '0', 700, poolAddr)
        const s2_expect_earnY_8 = getEarnYFromXAt((await logPowMath.getSqrtPrice(700)).toString(), '200000000000000000000')
        expect(s2_dec_700_8.earn).to.equal('0')
        expect(s2_dec_700_8.legacyEarn).to.equal(s2_expect_earnY_8)
        expect(s2_dec_700_8.actualDec).to.equal('0')
        expect(s2_dec_700_8.sold).to.equal('200000000000000000000')

        const s2_dec_700_8_2nd = await decLimOrderWithX(s2, testAddLimOrder, '200000000000000000000', 700, poolAddr)
        expect(s2_dec_700_8_2nd.earn).to.equal('0')
        expect(s2_dec_700_8_2nd.actualDec).to.equal('0')
        expect(s2_dec_700_8_2nd.sold).to.equal('0')

        const legacyEarnYRemain_8 = getSum([costYAt700_6, costYAt700_7, '-' + getSum([s1_dec_700_8.legacyEarn, s2_dec_700_8.legacyEarn, s3_add_700_8.legacyEarn])]);

        await checkLimOrder(
            '300000000000000000000', 
            getSum([accEarnX, earnXBefore7, earnXBefore8]), 
            getSum([accEarnX, earnXBefore7, earnXBefore8]),

            '0', 
            getSum([costYAt700_5, costYAt700_6, costYAt700_7, costYAt700_8]), 
            getSum([costYAt700_5, costYAt700_6, costYAt700_7]),

            '0', '0',

            undefined, legacyEarnYRemain_8, 
            poolAddr, 700)  
        // await checkLimOrder(
        //     '0', 
        //     getSum([costXAt700_1, costXAt700_2, costXAt700_3, costXAt700_4]), 
        //     getSum([costXAt700_1, costXAt700_2, costXAt700_3]),
        //     '300000000000000000000', '0', '0',
        //     '0', '0',
        //     legacyEarnRemain_4, '0', 
        //     poolAddr, 700)
    });



});