const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

const {getFeeCharge, getCostYFromXAt, amountAddFee, xInRange, yInRange, getPoolParts} = require('../funcs');
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

async function addLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr, liquidity) {
  await testMint.connect(miner).mint(tokenX.address, tokenY.address, fee, pl, pr, liquidity);
}

async function getState(pool) {
    const {sqrtPrice_96, currentPoint, currX, currY} = await pool.state();
    return {
        sqrtPrice_96: sqrtPrice_96.toString(),
        currentPoint: currentPoint.toString(),
        currX: currX.toString(),
        currY: currY.toString()
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

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, -8000);
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
    
    it("start with 1.3.3, end with 1.0", async function () {

        this.timeout(1000000);
           await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -12000, -5000, '1000000');
           await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -8000, 2000, '2000000');
           await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 50, 10050, '1000000');
           await addLiquidity(testMint, miner4, tokenX, tokenY, 3000, 9000, 12000, '2000000');
           await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '100000000000000000000', -11000);
           await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '200000000000000000000', -8000);
           await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '150000000000000000000', 350);
           await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '50000000000000000000', 9000);
           await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '80000000000000000000', 10050);
           await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '70000000000000000000', 10100);
   
           const costY_M7999_M5000 = yInRange('3000000', -7999, -5000, '1.0001', true);
           const acquireX_M7999_M5000 = xInRange('3000000', -7999, -5000, '1.0001', false);
   
           const costY_M5000_M50 = yInRange('2000000', -5000, -50, '1.0001', true);
           const acquireX_M5000_M50 = xInRange('2000000', -5000, -50, '1.0001', false);
   
           const costY_M50_50 = yInRange('2000000', -50, 50, '1.0001', true);
           const acquireX_M50_50 = xInRange('2000000', -50, 50, '1.0001', false);
   
           const costY_50_350 = yInRange('3000000', 50, 350, '1.0001', true);
           const acquireX_50_350 = xInRange('3000000', 50, 350, '1.0001', false);
   
           const costY_350_2000 = yInRange('3000000', 350, 2000, '1.0001', true);
           const acquireX_350_2000 = xInRange('3000000', 350, 2000, '1.0001', false);
   
           const costY_2000_9000 = yInRange('1000000', 2000, 9000, '1.0001', true);
           const acquireX_2000_9000 = xInRange('1000000', 2000, 9000, '1.0001', false);
   
           const costY_9000_10050 = yInRange('3000000', 9000, 10050, '1.0001', true);
           const acquireX_9000_10050 = xInRange('3000000', 9000, 10050, '1.0001', false);
   
           const costY_10050_10100 = yInRange('2000000', 10050, 10100, '1.0001', true);
           const acquireX_10050_10100 = xInRange('2000000', 10050, 10100, '1.0001', false);
   
           const costYAt350 = getCostYFromXAt((await logPowMath.getSqrtPrice(350)).toString(), '150000000000000000000');
           const acquireXAt350 = '150000000000000000000';
   
           const costYAt9000 = getCostYFromXAt((await logPowMath.getSqrtPrice(9000)).toString(), '50000000000000000000');
           const acquireXAt9000 = '50000000000000000000';
   
           const costYAt10050 = getCostYFromXAt((await logPowMath.getSqrtPrice(10050)).toString(), '80000000000000000000');
           const acquireXAt10050 = '80000000000000000000';
   
           // const costYAt10100 = getCostYFromXAt(10100, '1.0001', '70000000000000000000');
           // const acquireXAt10100 = '70000000000000000000';
   
           const costY_M7999_M5000_WithFee = amountAddFee(costY_M7999_M5000);
           const costY_M5000_M50_WithFee = amountAddFee(costY_M5000_M50);
           const costY_M50_50_WithFee = amountAddFee(costY_M50_50);
           const costY_50_350_WithFee = amountAddFee(costY_50_350);
           const costY_350_2000_WithFee = amountAddFee(costY_350_2000);
           const costY_2000_9000_WithFee = amountAddFee(costY_2000_9000);
           const costY_9000_10050_WithFee = amountAddFee(costY_9000_10050);
           const costY_10050_10100_WithFee = amountAddFee(costY_10050_10100);
           const costYAt350_WithFee = amountAddFee(costYAt350);
           const costYAt9000_WithFee = amountAddFee(costYAt9000);
           const costYAt10050_WithFee = amountAddFee(costYAt10050);
           // const costYAt10100_WithFee = amountAddFee(costYAt10100);
   
           const amountY1 = getSum([
               costY_M7999_M5000_WithFee, 
               costY_M5000_M50_WithFee,
               costY_M50_50_WithFee,
               costY_50_350_WithFee,
               costY_350_2000_WithFee,
               costY_2000_9000_WithFee,
               costY_9000_10050_WithFee,
               costY_10050_10100_WithFee,
               costYAt350_WithFee,
               costYAt9000_WithFee,
               costYAt10050_WithFee,
               // costYAt10100_WithFee,
               '1'
           ]);
   
           const costYExpect1 = getSum([
               costY_M7999_M5000_WithFee, 
               costY_M5000_M50_WithFee,
               costY_M50_50_WithFee,
               costY_50_350_WithFee,
               costY_350_2000_WithFee,
               costY_2000_9000_WithFee,
               costY_9000_10050_WithFee,
               costY_10050_10100_WithFee,
               costYAt350_WithFee,
               costYAt9000_WithFee,
               costYAt10050_WithFee,
               // costYAt10100_WithFee
           ]);
   
           const acquireXExpect1 = getSum([
               acquireX_M7999_M5000, 
               acquireX_M5000_M50,
               acquireX_M50_50,
               acquireX_50_350,
               acquireX_350_2000,
               acquireX_2000_9000,
               acquireX_9000_10050,
               acquireX_10050_10100,
               acquireXAt350,
               acquireXAt9000,
               acquireXAt10050,
               // acquireXAt10100,
           ]);
   
           console.log('amountY1: ', amountY1)
   
           const {acquireX: acquireX1, costY: costY1} = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, amountY1, 15000);
           
           console.log('costYAt350: ', costYAt350)
           expect(costYExpect1).to.equal(costY1);
           expect(acquireXExpect1).to.equal(acquireX1);
   
           console.log('costYExpect1: ', costYExpect1);
   
           console.log('costY1: ', costY1);
           console.log('acquireXExpect1: ', acquireXExpect1);
           console.log('acquireX1: ', acquireX1);
       });


    it("start with 1.3.4 and 3.0, end with 2.0", async function () {

        this.timeout(1000000);
           await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 50, 2000, '2000000');
           await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, 9000, 12000, '2000000');
           await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 10100, 12000, '1000000');

           await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, '200000000000000000000', -8000);
           await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '150000000000000000000', 350);
           
           const costY_50_350 = yInRange('2000000', 50, 350, '1.0001', true);
           const acquireX_50_350 = xInRange('2000000', 50, 350, '1.0001', false);
   
           const costY_350_2000 = yInRange('2000000', 350, 2000, '1.0001', true);
           const acquireX_350_2000 = xInRange('2000000', 350, 2000, '1.0001', false);

           const costY_9000_10100 = yInRange('2000000', 9000, 10100, '1.0001', true);
           const acquireX_9000_10100 = xInRange('2000000', 9000, 10100, '1.0001', false);

           const costYAt350 = getCostYFromXAt((await logPowMath.getSqrtPrice(350)).toString(), '150000000000000000000');
           const acquireXAt350 = '150000000000000000000';
   
   
           // const costYAt10100 = getCostYFromXAt(10100, '1.0001', '70000000000000000000');
           // const acquireXAt10100 = '70000000000000000000';
   
           const costY_50_350_WithFee = amountAddFee(costY_50_350);
           const costY_350_2000_WithFee = amountAddFee(costY_350_2000);
           const costY_9000_10100_WithFee = amountAddFee(costY_9000_10100);
           
           const costYAt350_WithFee = amountAddFee(costYAt350);
           // const costYAt10100_WithFee = amountAddFee(costYAt10100);
   
           const amountY1 = getSum([
               costY_50_350_WithFee,
               costY_350_2000_WithFee,
               costY_9000_10100_WithFee,
               costYAt350_WithFee,
               // costYAt10100_WithFee,
               '1'
           ]);
   
           const costYExpect1 = getSum([
               costY_50_350_WithFee,
               costY_350_2000_WithFee,
               costY_9000_10100_WithFee,
               costYAt350_WithFee,
               // costYAt10100_WithFee
           ]);
   
           const acquireXExpect1 = getSum([
               acquireX_50_350,
               acquireX_350_2000,
               acquireX_9000_10100,
               acquireXAt350,
               // acquireXAt10100,
           ]);
   
           console.log('amountY1: ', amountY1)
   
           const {acquireX: acquireX1, costY: costY1} = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, amountY1, 15000);
           
           console.log('costYAt350: ', costYAt350)
           expect(costYExpect1).to.equal(costY1);
           expect(acquireXExpect1).to.equal(acquireX1);
   
           console.log('costYExpect1: ', costYExpect1);
   
           console.log('costY1: ', costY1);
           console.log('acquireXExpect1: ', acquireXExpect1);
           console.log('acquireX1: ', acquireX1);
       });


    it("end with 2.2.1, 2.2.2, 2.2.3, and 2.2.4", async function () {

        this.timeout(1000000);
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -9650, 1050, '1000000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, 1050, 2200, '2000000');
        await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 2350, 2950, '1000000');
        await addLiquidity(testMint, miner4, tokenX, tokenY, 3000, 2600, 3000, '1000000');

        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '200000000000000000000', 2100);
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, '150000000000000000000', 2600);

        // -8000 ~1000
        const costY_M7999_M50 = yInRange('1000000', -7999, -50, '1.0001', true);
        const acquireX_M7999_M50 = xInRange('1000000', -7999, -50, '1.0001', false);
        const costY_M50_1000 = yInRange('1000000', -50, 1000, '1.0001', true);
        const acquireX_M50_1000 = xInRange('1000000', -50, 1000, '1.0001', false);

        // 1000 ~ 1050
        const costY_1000_1050 = yInRange('1000000', 1000, 1050, '1.0001', true);
        const acquireX_1000_1050 = xInRange('1000000', 1000, 1050, '1.0001', false);

        // 1050 ~ 2100
        const costY_1050_2100 = yInRange('2000000', 1050, 2100, '1.0001', true);
        const acquireX_1050_2100 = xInRange('2000000', 1050, 2100, '1.0001', false);

        // 2100 ~ 2200
        const costY_2100_2200 = yInRange('2000000', 2100, 2200, '1.0001', true);
        const acquireX_2100_2200 = xInRange('2000000', 2100, 2200, '1.0001', false);

        // 2350 ~ 2600
        const costY_2350_2600 = yInRange('1000000', 2350, 2600, '1.0001', true);
        const acquireX_2350_2600 = xInRange('1000000', 2350, 2600, '1.0001', false);

        // 2600 ~ 2950
        const costY_2600_2950 = yInRange('2000000', 2600, 2950, '1.0001', true);
        const acquireX_2600_2950 = xInRange('2000000', 2600, 2950, '1.0001', false);

        const costYAt2100 = getCostYFromXAt((await logPowMath.getSqrtPrice(2100)).toString(), '200000000000000000000');
        const acquireXAt2100 = '200000000000000000000';
    
        const costYAt2600 = getCostYFromXAt((await logPowMath.getSqrtPrice(2600)).toString(), '150000000000000000000');
        const acquireXAt2600 = '150000000000000000000';


        const costY_M7999_M50_WithFee = amountAddFee(costY_M7999_M50);
        const costY_M50_1000_WithFee = amountAddFee(costY_M50_1000);
        const costY_1000_1050_WithFee = amountAddFee(costY_1000_1050);
        const costY_1050_2100_WithFee = amountAddFee(costY_1050_2100);
        const costY_2100_2200_WithFee = amountAddFee(costY_2100_2200);
        const costY_2350_2600_WithFee = amountAddFee(costY_2350_2600);
        const costY_2600_2950_WithFee = amountAddFee(costY_2600_2950);

        const costYAt2100_WithFee = amountAddFee(costYAt2100);
        const costYAt2600_WithFee = amountAddFee(costYAt2600);

        console.log('costY_M7999_M50: ', costY_M7999_M50)
        console.log('costY_M50_1000: ', costY_M50_1000)

        // -8000 ~1000
        const {acquireX: acquireX1, costY: costY1} = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, getSum([
        costY_M7999_M50_WithFee, costY_M50_1000_WithFee
        ]), 1000);
        
        expect(costY1).to.equal(getSum([costY_M7999_M50_WithFee, costY_M50_1000_WithFee]));
        expect(acquireX1).to.equal(getSum([acquireX_M7999_M50, acquireX_M50_1000]));

        // 1000 ~ 2100
        const {acquireX: acquireX2, costY: costY2} = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, getSum([
        costY_1000_1050_WithFee, costY_1050_2100_WithFee
        ]), 100000);
        
        expect(costY2).to.equal(getSum([costY_1000_1050_WithFee, costY_1050_2100_WithFee]));
        expect(acquireX2).to.equal(getSum([acquireX_1000_1050, acquireX_1050_2100]));

        // 2100 ~ 2200
        const {acquireX: acquireX3, costY: costY3} = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, getSum([
        costY_2100_2200_WithFee, costYAt2100_WithFee
        ]), 100000);
        
        expect(costY3).to.equal(getSum([costY_2100_2200_WithFee, costYAt2100_WithFee]));
        expect(acquireX3).to.equal(getSum([acquireX_2100_2200, acquireXAt2100]));


        // 2200 ~ 2600
        const {acquireX: acquireX4, costY: costY4} = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, getSum([
        costY_2350_2600_WithFee
        ]), 100000);
        
        expect(costY4).to.equal(getSum([costY_2350_2600_WithFee]));
        expect(acquireX4).to.equal(getSum([acquireX_2350_2600]));


        // 2600 ~ 2950
        const {acquireX: acquireX5, costY: costY5} = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, getSum([
        costY_2600_2950_WithFee, costYAt2600_WithFee
        ]), 100000);
        
        expect(costY5).to.equal(getSum([costY_2600_2950_WithFee, costYAt2600_WithFee]));
        expect(acquireX5).to.equal(getSum([acquireX_2600_2950, acquireXAt2600]));
    });



    // it("end with 1.2.1 1.2.2 1.1", async function () {

    //     this.timeout(1000000);
    //     await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -9650, -5000, '1000000');
    //     await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -2000, 0, '1000000');
    //     await addLiquidity(testMint, miner3, tokenX, tokenY, 3000, 2550, 2900, '1000000');
    //     await addLiquidity(testMint, miner4, tokenX, tokenY, 3000, 3300, 5000, '1000000');

    //     await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '50000000000000000000', -1000);
    //     await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '60000000000000000000', 2500);
    //     await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '70000000000000000000', 2550);
    //     await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, '80000000000000000000', 3150);

    //     const amountYAtM7999 = stringMinus(l2y('300000', -7999, '1.0001', true), '1');
    //     const costYAt7999 = l2y('299999', -7999, '1.0001', true);
    //     const costXAt7999 = l2y('299999', -7999, '1.0001', true);
    //     await swapY2X(testSwap, trader, tokenX, tokenY, 3000, )

    // });
});