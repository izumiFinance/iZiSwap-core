const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");

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
        [signer, miner1, miner2, miner3, trader, seller, receiver] = await ethers.getSigners();

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

        await factory.newPool(txAddr, tyAddr, 3000, 500);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);


        await tokenX.mint(miner1.address, '1000000000000000000000000000000');
        await tokenY.mint(miner1.address, '1000000000000000000000000000000');
        await tokenX.mint(miner2.address, '1000000000000000000000000000000');
        await tokenY.mint(miner2.address, '1000000000000000000000000000000');
        await tokenX.mint(trader.address, '1000000000000000000000000000000');
        await tokenY.mint(trader.address, '1000000000000000000000000000000');
        await tokenX.mint(seller.address, '1000000000000000000000000000000');
        await tokenY.mint(seller.address, '1000000000000000000000000000000');

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
        await tokenX.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenX.connect(seller).approve(testAddLimOrder.address, '1000000000000000000000000000000');
        await tokenY.connect(seller).approve(testAddLimOrder.address, '1000000000000000000000000000000');

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

    });
    it("delta > 0, leftFlip, rightFlip, leftOld=0, rightOld!=0(limitOrder)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1200, '20000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        await addLimOrderWithX(tokenX, tokenY, seller, testAddLimOrder, '2600000', 1000);

        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        expect(await getStatusVal(poolAddr, -200)).to.equal(1);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(3);
        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // phase1
        const costY_651_800_1 = yInRange('30000', 651, 800, '1.0001', true);
        const costY_800_1000_1 = yInRange('50000', 800, 1000, '1.0001', true);

        const {costY: costYAt_1000_1} = limitCostY(1000, '1.0001', '2000000', '2600000');
        const {feeList: costYFeeList_1, feeAcquireList: costYFeeAcquireList_1} = getFeeOfList([costY_651_800_1, costY_800_1000_1], 3000);
        const costY_1 = stringAdd(stringAdd(getSum([costY_651_800_1, costY_800_1000_1]), getSum(costYFeeList_1)), costYAt_1000_1);

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costY_1, 1001);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(3);

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);

        console.log('costYFeeAcquireList_1: ', costYFeeAcquireList_1)
        console.log('costY_651_800_1: ', costY_651_800_1)
        console.log('costY_800_1000_1: ', costY_800_1000_1)

        const expectFeeScaleY_1 = stringAdd(
            stringDiv(stringMul(costYFeeAcquireList_1[0], q128), '30000'),
            stringDiv(stringMul(costYFeeAcquireList_1[1], q128), '50000'),
        );
        
        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_1, lastFeeScaleY_128: newScaleY_1} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_1 = stringLess(newScaleX_1, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_1, q256), lastFeeScaleX_128) : stringMinus(newScaleX_1, lastFeeScaleX_128);
        // const deltaScaleY_1 = stringLess(newScaleY_1, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_1, q256), lastFeeScaleY_128) : stringMinus(newScaleY_1, lastFeeScaleY_128);

        // expect(deltaScaleX_1).to.equal('0');
        // expect(deltaScaleY_1).to.equal(expectFeeScaleY_1);


        // phase2
        const costX_800_1000_2 = xInRange('50000', 800, 1000, '1.0001', true);
        const costX_500_800_2 = xInRange('30000', 500, 800, '1.0001', true);
        const {feeList: costXFeeList_2, feeAcquireList: costXFeeAcquireList_2} = getFeeOfList([costX_800_1000_2, costX_500_800_2], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 500);

        const expectFeeScaleX_2 = stringAdd(
            stringDiv(stringMul(costXFeeAcquireList_2[0], q128), '50000'),
            stringDiv(stringMul(costXFeeAcquireList_2[1], q128), '30000'),
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_2, lastFeeScaleY_128: newScaleY_2} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_2 = stringLess(newScaleX_2, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_2, q256), lastFeeScaleX_128) : stringMinus(newScaleX_2, lastFeeScaleX_128);
        // const deltaScaleY_2 = stringLess(newScaleY_2, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_2, q256), lastFeeScaleY_128) : stringMinus(newScaleY_2, lastFeeScaleY_128);

        // expect(deltaScaleX_2).to.equal(expectFeeScaleX_2);
        // expect(deltaScaleY_2).to.equal(expectFeeScaleY_1);

        // phase3
        const costX_100_500_3 = xInRange('30000', 100, 500, '1.0001', true);
        const costX_0_100_3 = xInRange('40000', 0, 100, '1.0001', true);
        const costX_M200_0_3 = xInRange('40000', -200, 0, '1.0001', true);

        const {feeList: costXFeeList_3, feeAcquireList: costXFeeAcquireList_3} = getFeeOfList([costX_100_500_3, costX_0_100_3, costX_M200_0_3], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);

        const expectFeeScaleX_3 = getSum(
            [
                stringDiv(stringMul(costXFeeAcquireList_3[0], q128), '30000'),
                stringDiv(stringMul(costXFeeAcquireList_3[1], q128), '40000'),
                stringDiv(stringMul(costXFeeAcquireList_3[2], q128), '40000'),
            ]
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_3, lastFeeScaleY_128: newScaleY_3} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_3 = stringLess(newScaleX_3, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_3, q256), lastFeeScaleX_128) : stringMinus(newScaleX_3, lastFeeScaleX_128);
        // const deltaScaleY_3 = stringLess(newScaleY_3, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_3, q256), lastFeeScaleY_128) : stringMinus(newScaleY_3, lastFeeScaleY_128);

        // expect(deltaScaleX_3).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        // expect(deltaScaleY_3).to.equal(expectFeeScaleY_1);

        // phase 4
        const costY_M200_M50_4 = yInRange('40000', -200, -50, '1.0001', true);
        const costY_M50_100_4 = yInRange('40000', -50, 100, '1.0001', true);
        const costY_100_600_4 = yInRange('30000', 100, 600, '1.0001', true);

        const {feeList: costYFeeList_4, feeAcquireList: costYFeeAcquireList_4} = getFeeOfList([costY_M200_M50_4, costY_M50_100_4, costY_100_600_4], 3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 600);

        const expectFeeScaleY_4 = getSum(
            [
                stringDiv(stringMul(costYFeeAcquireList_4[0], q128), '40000'),
                stringDiv(stringMul(costYFeeAcquireList_4[1], q128), '40000'),
                stringDiv(stringMul(costYFeeAcquireList_4[2], q128), '30000'),
            ]
        );

        await pool.connect(miner2).burn(-200, 1000, 0);
        const {lastFeeScaleX_128: newScaleX_4, lastFeeScaleY_128: newScaleY_4} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        const deltaScaleX_4 = stringLess(newScaleX_4, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_4, q256), lastFeeScaleX_128) : stringMinus(newScaleX_4, lastFeeScaleX_128);
        const deltaScaleY_4 = stringLess(newScaleY_4, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_4, q256), lastFeeScaleY_128) : stringMinus(newScaleY_4, lastFeeScaleY_128);

        expect(deltaScaleX_4).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        expect(deltaScaleY_4).to.equal(getSum([expectFeeScaleY_1, expectFeeScaleY_4]));

        const pointList = [-1000, -200, 100, 800, 1000, 1200];
        expect(await getBitsFromPool(poolAddr, 0)).to.equal(getExpectBits(0, pointList));
        expect(await getBitsFromPool(poolAddr, -1)).to.equal(getExpectBits(-1, pointList));

    });
    
    it("delta > 0, !leftFlip, rightFlip, leftOld!=0, rightOld=0", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, -200, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -200, 100, '5000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1200, '20000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        expect(await getStatusVal(poolAddr, -200)).to.equal(1);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);
        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // phase1
        const costY_651_800_1 = yInRange('30000', 651, 800, '1.0001', true);
        const costY_800_1000_1 = yInRange('50000', 800, 1000, '1.0001', true);

        const {feeList: costYFeeList_1, feeAcquireList: costYFeeAcquireList_1} = getFeeOfList([costY_651_800_1, costY_800_1000_1], 3000);

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);

        console.log('costYFeeAcquireList_1: ', costYFeeAcquireList_1)
        console.log('costY_651_800_1: ', costY_651_800_1)
        console.log('costY_800_1000_1: ', costY_800_1000_1)

        const expectFeeScaleY_1 = stringAdd(
            stringDiv(stringMul(costYFeeAcquireList_1[0], q128), '30000'),
            stringDiv(stringMul(costYFeeAcquireList_1[1], q128), '50000'),
        );
        
        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_1, lastFeeScaleY_128: newScaleY_1} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_1 = stringLess(newScaleX_1, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_1, q256), lastFeeScaleX_128) : stringMinus(newScaleX_1, lastFeeScaleX_128);
        // const deltaScaleY_1 = stringLess(newScaleY_1, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_1, q256), lastFeeScaleY_128) : stringMinus(newScaleY_1, lastFeeScaleY_128);

        // expect(deltaScaleX_1).to.equal('0');
        // expect(deltaScaleY_1).to.equal(expectFeeScaleY_1);


        // phase2
        const costX_800_1000_2 = xInRange('50000', 800, 1000, '1.0001', true);
        const costX_500_800_2 = xInRange('30000', 500, 800, '1.0001', true);
        const {feeList: costXFeeList_2, feeAcquireList: costXFeeAcquireList_2} = getFeeOfList([costX_800_1000_2, costX_500_800_2], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 500);

        const expectFeeScaleX_2 = stringAdd(
            stringDiv(stringMul(costXFeeAcquireList_2[0], q128), '50000'),
            stringDiv(stringMul(costXFeeAcquireList_2[1], q128), '30000'),
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_2, lastFeeScaleY_128: newScaleY_2} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_2 = stringLess(newScaleX_2, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_2, q256), lastFeeScaleX_128) : stringMinus(newScaleX_2, lastFeeScaleX_128);
        // const deltaScaleY_2 = stringLess(newScaleY_2, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_2, q256), lastFeeScaleY_128) : stringMinus(newScaleY_2, lastFeeScaleY_128);

        // expect(deltaScaleX_2).to.equal(expectFeeScaleX_2);
        // expect(deltaScaleY_2).to.equal(expectFeeScaleY_1);

        // phase3
        const costX_100_500_3 = xInRange('30000', 100, 500, '1.0001', true);
        const costX_0_100_3 = xInRange('35000', 0, 100, '1.0001', true);
        const costX_M200_0_3 = xInRange('35000', -200, 0, '1.0001', true);

        const {feeList: costXFeeList_3, feeAcquireList: costXFeeAcquireList_3} = getFeeOfList([costX_100_500_3, costX_0_100_3, costX_M200_0_3], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);

        const expectFeeScaleX_3 = getSum(
            [
                stringDiv(stringMul(costXFeeAcquireList_3[0], q128), '30000'),
                stringDiv(stringMul(costXFeeAcquireList_3[1], q128), '35000'),
                stringDiv(stringMul(costXFeeAcquireList_3[2], q128), '35000'),
            ]
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_3, lastFeeScaleY_128: newScaleY_3} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_3 = stringLess(newScaleX_3, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_3, q256), lastFeeScaleX_128) : stringMinus(newScaleX_3, lastFeeScaleX_128);
        // const deltaScaleY_3 = stringLess(newScaleY_3, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_3, q256), lastFeeScaleY_128) : stringMinus(newScaleY_3, lastFeeScaleY_128);

        // expect(deltaScaleX_3).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        // expect(deltaScaleY_3).to.equal(expectFeeScaleY_1);

        // phase 4
        const costY_M200_M50_4 = yInRange('35000', -200, -50, '1.0001', true);
        const costY_M50_100_4 = yInRange('35000', -50, 100, '1.0001', true);
        const costY_100_600_4 = yInRange('30000', 100, 600, '1.0001', true);

        const {feeList: costYFeeList_4, feeAcquireList: costYFeeAcquireList_4} = getFeeOfList([costY_M200_M50_4, costY_M50_100_4, costY_100_600_4], 3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 600);

        const expectFeeScaleY_4 = getSum(
            [
                stringDiv(stringMul(costYFeeAcquireList_4[0], q128), '35000'),
                stringDiv(stringMul(costYFeeAcquireList_4[1], q128), '35000'),
                stringDiv(stringMul(costYFeeAcquireList_4[2], q128), '30000'),
            ]
        );

        await pool.connect(miner2).burn(-200, 1000, 0);
        const {lastFeeScaleX_128: newScaleX_4, lastFeeScaleY_128: newScaleY_4} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        const deltaScaleX_4 = stringLess(newScaleX_4, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_4, q256), lastFeeScaleX_128) : stringMinus(newScaleX_4, lastFeeScaleX_128);
        const deltaScaleY_4 = stringLess(newScaleY_4, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_4, q256), lastFeeScaleY_128) : stringMinus(newScaleY_4, lastFeeScaleY_128);

        expect(deltaScaleX_4).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        expect(deltaScaleY_4).to.equal(getSum([expectFeeScaleY_1, expectFeeScaleY_4]));

        const pointList = [-1000, -200, 100, 800, 1000, 1200];
        expect(await getBitsFromPool(poolAddr, 0)).to.equal(getExpectBits(0, pointList));
        expect(await getBitsFromPool(poolAddr, -1)).to.equal(getExpectBits(-1, pointList));
    });

    it("delta > 0, leftFlip, !rightFlip, leftOld!=0, rightOld!=0", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 1200, '20000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1000, '5000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        await addLimOrderWithY(tokenX, tokenY, seller, testAddLimOrder, '2600000', -200);

        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        expect(await getStatusVal(poolAddr, -200)).to.equal(3);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);
        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // phase1
        const costY_651_800_1 = yInRange('30000', 651, 800, '1.0001', true);
        const costY_800_1000_1 = yInRange('35000', 800, 1000, '1.0001', true);

        const {feeList: costYFeeList_1, feeAcquireList: costYFeeAcquireList_1} = getFeeOfList([costY_651_800_1, costY_800_1000_1], 3000);
    
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);

        console.log('costYFeeAcquireList_1: ', costYFeeAcquireList_1)
        console.log('costY_651_800_1: ', costY_651_800_1)
        console.log('costY_800_1000_1: ', costY_800_1000_1)

        const expectFeeScaleY_1 = stringAdd(
            stringDiv(stringMul(costYFeeAcquireList_1[0], q128), '30000'),
            stringDiv(stringMul(costYFeeAcquireList_1[1], q128), '35000'),
        );
        
        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_1, lastFeeScaleY_128: newScaleY_1} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_1 = stringLess(newScaleX_1, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_1, q256), lastFeeScaleX_128) : stringMinus(newScaleX_1, lastFeeScaleX_128);
        // const deltaScaleY_1 = stringLess(newScaleY_1, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_1, q256), lastFeeScaleY_128) : stringMinus(newScaleY_1, lastFeeScaleY_128);

        // expect(deltaScaleX_1).to.equal('0');
        // expect(deltaScaleY_1).to.equal(expectFeeScaleY_1);


        // phase2
        const costX_800_1000_2 = xInRange('35000', 800, 1000, '1.0001', true);
        const costX_500_800_2 = xInRange('30000', 500, 800, '1.0001', true);
        const {feeList: costXFeeList_2, feeAcquireList: costXFeeAcquireList_2} = getFeeOfList([costX_800_1000_2, costX_500_800_2], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 500);

        const expectFeeScaleX_2 = stringAdd(
            stringDiv(stringMul(costXFeeAcquireList_2[0], q128), '35000'),
            stringDiv(stringMul(costXFeeAcquireList_2[1], q128), '30000'),
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_2, lastFeeScaleY_128: newScaleY_2} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_2 = stringLess(newScaleX_2, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_2, q256), lastFeeScaleX_128) : stringMinus(newScaleX_2, lastFeeScaleX_128);
        // const deltaScaleY_2 = stringLess(newScaleY_2, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_2, q256), lastFeeScaleY_128) : stringMinus(newScaleY_2, lastFeeScaleY_128);

        // expect(deltaScaleX_2).to.equal(expectFeeScaleX_2);
        // expect(deltaScaleY_2).to.equal(expectFeeScaleY_1);

        // phase3
        const costX_100_500_3 = xInRange('30000', 100, 500, '1.0001', true);
        const costX_0_100_3 = xInRange('40000', 0, 100, '1.0001', true);
        const costX_M200_0_3 = xInRange('40000', -200, 0, '1.0001', true);

        const {feeList: costXFeeList_3, feeAcquireList: costXFeeAcquireList_3} = getFeeOfList([costX_100_500_3, costX_0_100_3, costX_M200_0_3], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);

        const expectFeeScaleX_3 = getSum(
            [
                stringDiv(stringMul(costXFeeAcquireList_3[0], q128), '30000'),
                stringDiv(stringMul(costXFeeAcquireList_3[1], q128), '40000'),
                stringDiv(stringMul(costXFeeAcquireList_3[2], q128), '40000'),
            ]
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_3, lastFeeScaleY_128: newScaleY_3} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_3 = stringLess(newScaleX_3, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_3, q256), lastFeeScaleX_128) : stringMinus(newScaleX_3, lastFeeScaleX_128);
        // const deltaScaleY_3 = stringLess(newScaleY_3, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_3, q256), lastFeeScaleY_128) : stringMinus(newScaleY_3, lastFeeScaleY_128);

        // expect(deltaScaleX_3).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        // expect(deltaScaleY_3).to.equal(expectFeeScaleY_1);

        // phase 4
        const costY_M200_M50_4 = yInRange('40000', -200, -50, '1.0001', true);
        const costY_M50_100_4 = yInRange('40000', -50, 100, '1.0001', true);
        const costY_100_600_4 = yInRange('30000', 100, 600, '1.0001', true);

        const {feeList: costYFeeList_4, feeAcquireList: costYFeeAcquireList_4} = getFeeOfList([costY_M200_M50_4, costY_M50_100_4, costY_100_600_4], 3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 600);

        const expectFeeScaleY_4 = getSum(
            [
                stringDiv(stringMul(costYFeeAcquireList_4[0], q128), '40000'),
                stringDiv(stringMul(costYFeeAcquireList_4[1], q128), '40000'),
                stringDiv(stringMul(costYFeeAcquireList_4[2], q128), '30000'),
            ]
        );

        await pool.connect(miner2).burn(-200, 1000, 0);
        const {lastFeeScaleX_128: newScaleX_4, lastFeeScaleY_128: newScaleY_4} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        const deltaScaleX_4 = stringLess(newScaleX_4, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_4, q256), lastFeeScaleX_128) : stringMinus(newScaleX_4, lastFeeScaleX_128);
        const deltaScaleY_4 = stringLess(newScaleY_4, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_4, q256), lastFeeScaleY_128) : stringMinus(newScaleY_4, lastFeeScaleY_128);

        expect(deltaScaleX_4).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        expect(deltaScaleY_4).to.equal(getSum([expectFeeScaleY_1, expectFeeScaleY_4]));

        const pointList = [-1000, -200, 100, 800, 1000, 1200];
        expect(await getBitsFromPool(poolAddr, 0)).to.equal(getExpectBits(0, pointList));
        expect(await getBitsFromPool(poolAddr, -1)).to.equal(getExpectBits(-1, pointList));
    });

    it("delta > 0, !leftFlip, !rightFlip, leftOld!=0, rightOld!=0 (1)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -200, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 1200, '20000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        expect(await getStatusVal(poolAddr, -200)).to.equal(1);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);
        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // phase1
        const costY_651_1000_1 = yInRange('30000', 651, 1000, '1.0001', true);

        const {feeAcquireList: costYFeeAcquireList_1} = getFeeOfList([costY_651_1000_1], 3000);
    
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);

        console.log('costYFeeAcquireList_1: ', costYFeeAcquireList_1)
        console.log('costY_651_1000_1: ', costY_651_1000_1)

        const expectFeeScaleY_1 = stringDiv(stringMul(costYFeeAcquireList_1[0], q128), '30000');
        
        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_1, lastFeeScaleY_128: newScaleY_1} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_1 = stringLess(newScaleX_1, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_1, q256), lastFeeScaleX_128) : stringMinus(newScaleX_1, lastFeeScaleX_128);
        // const deltaScaleY_1 = stringLess(newScaleY_1, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_1, q256), lastFeeScaleY_128) : stringMinus(newScaleY_1, lastFeeScaleY_128);

        // expect(deltaScaleX_1).to.equal('0');
        // expect(deltaScaleY_1).to.equal(expectFeeScaleY_1);


        // phase2
        const costX_500_1000_2 = xInRange('30000', 500, 1000, '1.0001', true);
        const {feeList: costXFeeList_2, feeAcquireList: costXFeeAcquireList_2} = getFeeOfList([costX_500_1000_2], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 500);

        const expectFeeScaleX_2 = stringDiv(stringMul(costXFeeAcquireList_2[0], q128), '30000');

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_2, lastFeeScaleY_128: newScaleY_2} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_2 = stringLess(newScaleX_2, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_2, q256), lastFeeScaleX_128) : stringMinus(newScaleX_2, lastFeeScaleX_128);
        // const deltaScaleY_2 = stringLess(newScaleY_2, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_2, q256), lastFeeScaleY_128) : stringMinus(newScaleY_2, lastFeeScaleY_128);

        // expect(deltaScaleX_2).to.equal(expectFeeScaleX_2);
        // expect(deltaScaleY_2).to.equal(expectFeeScaleY_1);

        // phase3
        const costX_100_500_3 = xInRange('30000', 100, 500, '1.0001', true);
        const costX_0_100_3 = xInRange('40000', 0, 100, '1.0001', true);
        const costX_M200_0_3 = xInRange('40000', -200, 0, '1.0001', true);

        const {feeList: costXFeeList_3, feeAcquireList: costXFeeAcquireList_3} = getFeeOfList([costX_100_500_3, costX_0_100_3, costX_M200_0_3], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);

        const expectFeeScaleX_3 = getSum(
            [
                stringDiv(stringMul(costXFeeAcquireList_3[0], q128), '30000'),
                stringDiv(stringMul(costXFeeAcquireList_3[1], q128), '40000'),
                stringDiv(stringMul(costXFeeAcquireList_3[2], q128), '40000'),
            ]
        );

        await pool.connect(miner2).burn(-200, 1000, 0);
        const {lastFeeScaleX_128: newScaleX_3, lastFeeScaleY_128: newScaleY_3} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        const deltaScaleX_3 = stringLess(newScaleX_3, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_3, q256), lastFeeScaleX_128) : stringMinus(newScaleX_3, lastFeeScaleX_128);
        const deltaScaleY_3 = stringLess(newScaleY_3, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_3, q256), lastFeeScaleY_128) : stringMinus(newScaleY_3, lastFeeScaleY_128);

        expect(deltaScaleX_3).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        expect(deltaScaleY_3).to.equal(expectFeeScaleY_1);

        // phase 4
        const costY_M200_M50_4 = yInRange('40000', -200, -50, '1.0001', true);
        const costY_M50_100_4 = yInRange('40000', -50, 100, '1.0001', true);
        const costY_100_600_4 = yInRange('30000', 100, 600, '1.0001', true);

        const {feeList: costYFeeList_4, feeAcquireList: costYFeeAcquireList_4} = getFeeOfList([costY_M200_M50_4, costY_M50_100_4, costY_100_600_4], 3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 600);

        const expectFeeScaleY_4 = getSum(
            [
                stringDiv(stringMul(costYFeeAcquireList_4[0], q128), '40000'),
                stringDiv(stringMul(costYFeeAcquireList_4[1], q128), '40000'),
                stringDiv(stringMul(costYFeeAcquireList_4[2], q128), '30000'),
            ]
        );

        await pool.connect(miner2).burn(-200, 1000, 0);
        const {lastFeeScaleX_128: newScaleX_4, lastFeeScaleY_128: newScaleY_4} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        const deltaScaleX_4 = stringLess(newScaleX_4, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_4, q256), lastFeeScaleX_128) : stringMinus(newScaleX_4, lastFeeScaleX_128);
        const deltaScaleY_4 = stringLess(newScaleY_4, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_4, q256), lastFeeScaleY_128) : stringMinus(newScaleY_4, lastFeeScaleY_128);

        expect(deltaScaleX_4).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        expect(deltaScaleY_4).to.equal(getSum([expectFeeScaleY_1, expectFeeScaleY_4]));

        const pointList = [-200, 100, 1000, 1200];
        expect(await getBitsFromPool(poolAddr, 0)).to.equal(getExpectBits(0, pointList));
        expect(await getBitsFromPool(poolAddr, -1)).to.equal(getExpectBits(-1, pointList));
    });

    it("delta > 0, !leftFlip, !rightFlip, leftOld!=0, rightOld!=0 (2)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, -200, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1000, '20000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        expect(await getStatusVal(poolAddr, -200)).to.equal(1);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);
        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // phase1
        const costY_651_800_1 = yInRange('30000', 651, 800, '1.0001', true);
        const costY_800_1000_1 = yInRange('50000', 800, 1000, '1.0001', true);

        const {feeAcquireList: costYFeeAcquireList_1} = getFeeOfList([costY_651_800_1, costY_800_1000_1], 3000);
    
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        expect(await getStatusVal(poolAddr, 1000)).to.equal(1);

        console.log('costYFeeAcquireList_1: ', costYFeeAcquireList_1)

        const expectFeeScaleY_1 = getSum(
            [
                stringDiv(stringMul(costYFeeAcquireList_1[0], q128), '30000'),
                stringDiv(stringMul(costYFeeAcquireList_1[1], q128), '50000'),
            ]
        );
        
        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_1, lastFeeScaleY_128: newScaleY_1} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_1 = stringLess(newScaleX_1, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_1, q256), lastFeeScaleX_128) : stringMinus(newScaleX_1, lastFeeScaleX_128);
        // const deltaScaleY_1 = stringLess(newScaleY_1, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_1, q256), lastFeeScaleY_128) : stringMinus(newScaleY_1, lastFeeScaleY_128);

        // expect(deltaScaleX_1).to.equal('0');
        // expect(deltaScaleY_1).to.equal(expectFeeScaleY_1);


        // phase2
        const costX_800_1000_2 = xInRange('50000', 800, 1000, '1.0001', true);
        const costX_500_800_2 = xInRange('30000', 500, 800, '1.0001', true);
        const {feeList: costXFeeList_2, feeAcquireList: costXFeeAcquireList_2} = getFeeOfList([costX_800_1000_2, costX_500_800_2], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 500);

        const expectFeeScaleX_2 = stringAdd(
            stringDiv(stringMul(costXFeeAcquireList_2[0], q128), '50000'),
            stringDiv(stringMul(costXFeeAcquireList_2[1], q128), '30000')
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_2, lastFeeScaleY_128: newScaleY_2} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_2 = stringLess(newScaleX_2, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_2, q256), lastFeeScaleX_128) : stringMinus(newScaleX_2, lastFeeScaleX_128);
        // const deltaScaleY_2 = stringLess(newScaleY_2, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_2, q256), lastFeeScaleY_128) : stringMinus(newScaleY_2, lastFeeScaleY_128);

        // expect(deltaScaleX_2).to.equal(expectFeeScaleX_2);
        // expect(deltaScaleY_2).to.equal(expectFeeScaleY_1);

        // phase3
        const costX_0_500_3 = xInRange('30000', 0, 500, '1.0001', true);
        const costX_M200_0_3 = xInRange('30000', -200, 0, '1.0001', true);

        const {feeList: costXFeeList_3, feeAcquireList: costXFeeAcquireList_3} = getFeeOfList([costX_0_500_3, costX_M200_0_3], 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);

        const expectFeeScaleX_3 = getSum(
            [
                stringDiv(stringMul(costXFeeAcquireList_3[0], q128), '30000'),
                stringDiv(stringMul(costXFeeAcquireList_3[1], q128), '30000'),
            ]
        );

        // await pool.connect(miner2).burn(-200, 1000, 0);
        // const {lastFeeScaleX_128: newScaleX_3, lastFeeScaleY_128: newScaleY_3} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        // const deltaScaleX_3 = stringLess(newScaleX_3, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_3, q256), lastFeeScaleX_128) : stringMinus(newScaleX_3, lastFeeScaleX_128);
        // const deltaScaleY_3 = stringLess(newScaleY_3, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_3, q256), lastFeeScaleY_128) : stringMinus(newScaleY_3, lastFeeScaleY_128);

        // expect(deltaScaleX_3).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        // expect(deltaScaleY_3).to.equal(expectFeeScaleY_1);

        // phase 4
        const costY_M200_M50_4 = yInRange('30000', -200, -50, '1.0001', true);
        const costY_M50_600_4 = yInRange('30000', -50, 600, '1.0001', true);

        const {feeList: costYFeeList_4, feeAcquireList: costYFeeAcquireList_4} = getFeeOfList([costY_M200_M50_4, costY_M50_600_4], 3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 600);

        const expectFeeScaleY_4 = getSum(
            [
                stringDiv(stringMul(costYFeeAcquireList_4[0], q128), '30000'),
                stringDiv(stringMul(costYFeeAcquireList_4[1], q128), '30000'),
            ]
        );

        await pool.connect(miner2).burn(-200, 1000, 0);
        const {lastFeeScaleX_128: newScaleX_4, lastFeeScaleY_128: newScaleY_4} = await getLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000);

        const deltaScaleX_4 = stringLess(newScaleX_4, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX_4, q256), lastFeeScaleX_128) : stringMinus(newScaleX_4, lastFeeScaleX_128);
        const deltaScaleY_4 = stringLess(newScaleY_4, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY_4, q256), lastFeeScaleY_128) : stringMinus(newScaleY_4, lastFeeScaleY_128);

        expect(deltaScaleX_4).to.equal(getSum([expectFeeScaleX_2, expectFeeScaleX_3]));
        expect(deltaScaleY_4).to.equal(getSum([expectFeeScaleY_1, expectFeeScaleY_4]));

        const pointList = [-1000, -200, 800, 1000];
        expect(await getBitsFromPool(poolAddr, 0)).to.equal(getExpectBits(0, pointList));
        expect(await getBitsFromPool(poolAddr, -1)).to.equal(getExpectBits(-1, pointList));
    });
});