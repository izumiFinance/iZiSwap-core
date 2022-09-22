const { expect, use } = require("chai");
const { ethers } = require("hardhat");
const {getPoolParts} = require("../funcs.js");
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
    const {sqrtPrice_96, currentPoint, liquidity, liquidityX} = await pool.state();
    return {
        sqrtPrice_96: sqrtPrice_96.toString(),
        currentPoint: currentPoint.toString(),
        liquidity: liquidity.toString(),
        liquidityX: liquidityX.toString()
    }
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

function stringMin(a, b) {
    if (stringLess(a, b)) {
        return a;
    } else {
        return b;
    }
}
function l2y(liquidity, tick, rate, up) {
    price = BigNumber(rate).pow(tick);
    y = BigNumber(liquidity).times(price.sqrt());
    if (up) {
        return y.toFixed(0, 2);
    } else {
        return y.toFixed(0, 3);
    }
}

function l2x(liquidity, tick, rate, up) {
    price = BigNumber(rate).pow(tick);
    x = BigNumber(liquidity).div(price.sqrt());
    if (up) {
        return x.toFixed(0, 2);
    } else {
        return x.toFixed(0, 3);
    }
}

function floor(a) {
    return a.toFixed(0, 3);
}
function ceil(b) {
    return b.toFixed(0, 2);
}

function x2l(x, tick, rate, up) {
    const price = BigNumber(rate).pow(tick);
    const l = BigNumber(x).times(price.sqrt());
    if (up) {
        return ceil(l);
    } else {
        return floor(l);
    }
}

function y2l(y, tick, rate, up) {
    const price = BigNumber(rate).pow(tick);
    const l = BigNumber(y).div(price.sqrt());
    if (up) {
        return ceil(l);
    } else {
        return floor(l);
    }
}
function y2xAtLiquidity(point, rate, amountY, liquidity, liquidityX) {
    const maxLiquidityX = y2l(amountY, point, rate, false);

    const transformLiquidityY = stringMin(maxLiquidityX, liquidityX);
    const acquireX = l2x(transformLiquidityY, point, rate, false);
    const costY = l2y(transformLiquidityY, point, rate, true);
    return {acquireX, costY, liquidityX: stringMinus(liquidityX, transformLiquidityY)};
}
function y2xAtLiquidityDesireX(point, rate, desireX, liquidity, liquidityX) {
    const maxLiquidityX = x2l(desireX, point, rate, true);

    const transformLiquidityY = stringMin(maxLiquidityX, liquidityX);
    const acquireX = l2x(transformLiquidityY, point, rate, false);
    const costY = l2y(transformLiquidityY, point, rate, true);
    return {acquireX, costY, liquidityX: stringMinus(liquidityX, transformLiquidityY)};
}

function x2yAtLiquidity(point, rate, amountX, liquidity, liquidityX) {
    const liquidityY = stringMinus(liquidity, liquidityX);
    const maxLiquidityY = x2l(amountX, point, rate, false);

    const transformLiquidityX = stringMin(liquidityY, maxLiquidityY);
    const acquireY = l2y(transformLiquidityX, point, rate, false);
    const costX = l2x(transformLiquidityX, point, rate, true);
    return {acquireY, costX, liquidityX: stringAdd(liquidityX, transformLiquidityX)};
}
function yInRange(liquidity, pl, pr, rate, up) {
    let amountY = BigNumber("0");
    const price = BigNumber(rate).pow(pl);
    const l = BigNumber(liquidity);
    for (var i = pl; i < pr; i ++) {
        amountY = amountY.plus(l.times(price.sqrt()));
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
    const price = BigNumber(rate).pow(pl);
    const l = BigNumber(liquidity);
    for (var i = pl; i < pr; i ++) {
        amountX = amountX.plus(l.div(price.sqrt()));
        price = price.times(rate);
    }
    if (up) {
        return ceil(amountX);
    } else {
        return floor(amountX);
    }
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
    return ceil(BigNumber(amount).times(1000).div(997));
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
    var signer, miner1, miner2, trader, trader2, receiver;
    var poolAddr;
    var pool;
    var testMint;
    var testSwap;
    var q128;
    var q256;
    var expectFeeScaleX, expectFeeScaleX;
    var testAddLimOrder;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, trader, trader2, receiver] = await ethers.getSigners();

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

        await factory.newPool(txAddr, tyAddr, 3000, -2000);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);


        await tokenX.mint(miner1.address, '1000000000000000000000000000000');
        await tokenY.mint(miner1.address, '1000000000000000000000000000000');
        await tokenX.mint(miner2.address, '1000000000000000000000000000000');
        await tokenY.mint(miner2.address, '1000000000000000000000000000000');
        await tokenX.mint(trader.address, '1000000000000000000000000000000');
        await tokenY.mint(trader.address, '1000000000000000000000000000000');
        await tokenX.mint(trader2.address, '1000000000000000000000000000000');
        await tokenY.mint(trader2.address, '1000000000000000000000000000000');

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
        await tokenX.connect(trader2).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader2).approve(testSwap.address, '1000000000000000000000000000000');

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);


    });
  
    it("1.1 startHasY, result liquidityX > 0, rightPt > cp + 1", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1009;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const desireXAtCp = l2x('21111', cp, '1.0001', true);
        const expectResAtCp = y2xAtLiquidityDesireX(cp, '1.0001', desireXAtCp, '30000', '28000');
        const costYAtCp = expectResAtCp.costY;
        const costYAtCpWithFee = amountAddFee(costYAtCp);

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, desireXAtCp, 100000);
        expect(swapResAtCp.costY).to.equal(costYAtCpWithFee);
        expect(swapResAtCp.acquireX).to.equal(expectResAtCp.acquireX);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(cp));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal(stringMinus('28000', '21112'));
    });  

    it("1.2 startHasY, result liquidityX == 0, desireX <= acquireY, rightPt > cp + 1", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1009;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const desireXAtCp = l2x('28000', cp, '1.0001', false);
        const expectResAtCp = y2xAtLiquidityDesireX(cp, '1.0001', desireXAtCp, '30000', '28000');
        const costYAtCpWithFee = amountAddFee(expectResAtCp.costY);

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, desireXAtCp, 100000);
        expect(swapResAtCp.costY).to.equal(costYAtCpWithFee);
        expect(swapResAtCp.acquireX).to.equal(expectResAtCp.acquireX);
        console.log('acquireX, desireX: ', expectResAtCp.acquireX, desireXAtCp)

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(cp));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('0');
    });  

    it("1.3.1 startHasY, result liquidityX == 0, costY < amountY, rightPt = cp + 1", async function () {

        const rightPt = -1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const costYAtCp = l2y('28000', cp, '1.0001', true);
        const acquireXAtCp = l2x('28000', cp, '1.0001', false);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const desireXAtRightPt = l2x('15000', cp, '1.0001', false);
        const expectResAtRightPt = y2xAtLiquidityDesireX(rightPt, '1.0001', desireXAtRightPt, '50000', '50000');

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, getSum([acquireXAtCp, desireXAtRightPt]), 100000);
        expect(swapResAtCp.costY).to.equal(getSum([costYAtCpWithFee, amountAddFee(expectResAtRightPt.costY)]));
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireXAtCp, expectResAtRightPt.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(rightPt));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('35000');
    });  

    it("1.3.2.1 startHasY, result liquidityX == 0, costY < amountY, rightPt > cp + 1", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const costYAtCp = l2y('28000', cp, '1.0001', true);
        const acquireXAtCp = l2x('28000', cp, '1.0001', false);

        const costY_M1000_M50 = yInRange('30000', -1000, -50, '1.0001', true);
        const acquireX_M1000_M50 = xInRange('30000', -1000, -50, '1.0001', false);
        const costY_M1001_M50_WithFee = amountAddFee(getSum([costYAtCp, costY_M1000_M50]));

        const costY_M50_1000 = yInRange('30000', -50, 1000, '1.0001', true);
        const acquireX_M50_1000 = xInRange('30000', -50, 1000, '1.0001', false);
        const costY_M50_1000_WithFee = amountAddFee(costY_M50_1000);

        const desireXAtRightPt = l2x('12000', rightPt, '1.0001', false);
        const expectResAtRightPt = y2xAtLiquidityDesireX(rightPt, '1.0001', desireXAtRightPt, '50000', '50000');
        const costYAtRightPtWithFee = amountAddFee(expectResAtRightPt.costY);

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, getSum([acquireXAtCp, acquireX_M1000_M50, acquireX_M50_1000, desireXAtRightPt]), 100000);
        expect(swapResAtCp.costY).to.equal(getSum([costY_M1001_M50_WithFee, costY_M50_1000_WithFee, costYAtRightPtWithFee]));
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireXAtCp, acquireX_M1000_M50, acquireX_M50_1000, expectResAtRightPt.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(rightPt));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('38000');
    }); 

    it("1.3.2.2 startHasY, result liquidityX == 0, costY < amountY, locPt = cp + 1", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const costYAtCp = l2y('28000', cp, '1.0001', true);
        const acquireXAtCp = l2x('28000', cp, '1.0001', false);

        const acquireX_M1000_M999_NotEnough = stringMinus(xInRange('30000', -1000, -999, '1.0001', false), '1');
        const expectResAtM1000 = y2xAtLiquidityDesireX(-1000, '1.0001', acquireX_M1000_M999_NotEnough, '30000', '30000');
        const costYCpM1000_WithFee = amountAddFee(getSum([costYAtCp, expectResAtM1000.costY]));

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, getSum([acquireXAtCp, acquireX_M1000_M999_NotEnough]), rightPt);
        expect(swapResAtCp.costY).to.equal(costYCpM1000_WithFee);
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireXAtCp, expectResAtM1000.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(-1000));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal(expectResAtM1000.liquidityX);
    }); 

    it("1.3.2.3 startHasY, result liquidityX == 0, costY < amountY, locPt > cp + 1", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const costYAtCp = l2y('28000', cp, '1.0001', true);
        const acquireXAtCp = l2x('28000', cp, '1.0001', false);

        const costY_M1000_M50 = yInRange('30000', -1000, -50, '1.0001', true);
        const acquireX_M1000_M50 = xInRange('30000', -1000, -50, '1.0001', false);
        const costY_M1001_M50_WithFee = amountAddFee(getSum([costYAtCp, costY_M1000_M50]));

        const costY_M50_212 = yInRange('30000', -50, 212, '1.0001', true);
        const acquireX_M50_212 = xInRange('30000', -50, 212, '1.0001', false);

        const desireXAt212 = l2y('11000', 212, '1.0001', false);
        const expectResAt212 = y2xAtLiquidity(212, '1.0001', desireXAt212, '30000', '30000');
        const costY_M50_213_WithFee = amountAddFee(getSum([costY_M50_212, expectResAt212.costY]));

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, getSum([acquireXAtCp, acquireX_M1000_M50, acquireX_M50_212, expectResAt212.acquireX]), 10000);
        expect(swapResAtCp.costY).to.equal(getSum([costY_M1001_M50_WithFee, costY_M50_213_WithFee]));
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireXAtCp, acquireX_M1000_M50, acquireX_M50_212, expectResAt212.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(212));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal(expectResAt212.liquidityX);
    }); 

    it("1.3.2.3.1 startHasY, result liquidityX == 0, costY < amountY, locPt > cp + 1", async function () {

        const rightPt = -50;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const costYAtCp = l2y('28000', cp, '1.0001', true);
        const acquireXAtCp = l2x('28000', cp, '1.0001', false);

        const costY_M1000_M90 = yInRange('30000', -1000, -90, '1.0001', true);
        const acquireX_M1000_M90 = xInRange('30000', -1000, -90, '1.0001', false);

        const desireXAtM90 = l2x('11000', -90, '1.0001', false);
        const expectResAtM90 = y2xAtLiquidityDesireX(-90, '1.0001', desireXAtM90, '30000', '30000');
        const costY_M1001_M89_WithFee = amountAddFee(getSum([costYAtCp, costY_M1000_M90, expectResAtM90.costY]));

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, getSum([acquireXAtCp, acquireX_M1000_M90, desireXAtM90]), 10000);
        expect(swapResAtCp.costY).to.equal(costY_M1001_M89_WithFee);
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireXAtCp, acquireX_M1000_M90, expectResAtM90.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(-90));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('19000');
    }); 
    it("1.3.2.4 startHasY, result liquidityX == 0, costY < amountY, locPt = rightPt - 1", async function () {

        const rightPt = -50;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCpTrader2 = l2y('2000', cp, '1.0001', true);
        const costYAtCpWithFeeTrader2 = amountAddFee(costYAtCpTrader2);
        const {liquidityX: liquidityXStart} = y2xAtLiquidity(cp, '1.0001', costYAtCpTrader2, '30000', '30000')

        console.log('liquidityXStart: ', liquidityXStart);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFeeTrader2, cp + 1);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('28000');

        const costYAtCp = l2y('28000', cp, '1.0001', true);
        const acquireXAtCp = l2x('28000', cp, '1.0001', false);

        const costY_M1000_M51 = yInRange('30000', -1000, -51, '1.0001', true);
        const acquireX_M1000_M51 = xInRange('30000', -1000, -51, '1.0001', false);

        const acquireX_M1000_M50_NotEnough = stringMinus(xInRange('30000', -1000, -50, '1.0001', false), '1');

        const desireXAtM51 = stringMinus(acquireX_M1000_M50_NotEnough, acquireX_M1000_M51);
        const expectResAtM51 = y2xAtLiquidityDesireX(-51, '1.0001', desireXAtM51, '30000', '30000');
        const costY_M1001_M50_WithFee = amountAddFee(getSum([costYAtCp, costY_M1000_M51, expectResAtM51.costY]));

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, getSum([acquireXAtCp, acquireX_M1000_M51, desireXAtM51]), 100000);
        expect(swapResAtCp.costY).to.equal(costY_M1001_M50_WithFee);
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireXAtCp, acquireX_M1000_M51, expectResAtM51.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(-51));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal(expectResAtM51.liquidityX);
    }); 
    
    
    it("2.1 !startHasY, result liquidityX == 0, costY < amountY, rightPt = cp + 1, complete range, finish", async function () {

        const rightPt = -1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('30000');

        const costY_M1001_M1000 = yInRange('30000', -1001, -1000, '1.0001', true);
        const acquireX_M1001_M1000 = xInRange('30000', -1001, -1000, '1.0001', false);
        const costY_M1001_M1000_WithFee = amountAddFee(costY_M1001_M1000);

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, acquireX_M1001_M1000, 100000);
        expect(swapResAtCp.costY).to.equal(costY_M1001_M1000_WithFee);
        expect(swapResAtCp.acquireX).to.equal(acquireX_M1001_M1000);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(rightPt));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('50000');
    }); 

    it("2.1.1 !startHasY, result liquidityX == 0, costY < amountY, rightPt > cp + 1, complete range, finish", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('30000');

        const costY_M1001_M50 = yInRange('30000', -1001, -50, '1.0001', true);
        const acquireX_M1001_M50 = xInRange('30000', -1001, -50, '1.0001', false);
        const costY_M1001_M50_WithFee = amountAddFee(costY_M1001_M50);

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, acquireX_M1001_M50, 100000);
        expect(swapResAtCp.costY).to.equal(costY_M1001_M50_WithFee);
        expect(swapResAtCp.acquireX).to.equal(acquireX_M1001_M50);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(-50));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('30000');
    }); 

    it("2.2 !startHasY, result liquidityX == 0, costY < amountY, locPt = cp", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('30000');

        const desireXAtM1001 = l2x('9999', -1001, '1.0001', true)
        const expectResAtM1001 = y2xAtLiquidityDesireX(-1001, '1.0001', desireXAtM1001, '30000', '30000');
        const costYAtM1001_WithFee = amountAddFee(expectResAtM1001.costY);

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, desireXAtM1001, rightPt);
        expect(swapResAtCp.costY).to.equal(costYAtM1001_WithFee);
        expect(swapResAtCp.acquireX).to.equal(expectResAtM1001.acquireX);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(-1001));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('20000');
    }); 

    it("2.3 !startHasY, result liquidityX == 0, costY < amountY, locPt > cp", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('30000');

        const costY_M1001_M90 = yInRange('30000', -1001, -90, '1.0001', true);
        const acquireX_M1001_M90 = xInRange('30000', -1001, -90, '1.0001', false);

        const desireXAtM90 = l2x('12000', -90, '1.0001', false);
        const expectResAtM90 = y2xAtLiquidityDesireX(-90, '1.0001', desireXAtM90, '30000', '30000');
        const costY_M1001_M89_WithFee = amountAddFee(getSum([costY_M1001_M90, expectResAtM90.costY]));

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, getSum([acquireX_M1001_M90, desireXAtM90]), 10000);
        expect(swapResAtCp.costY).to.equal(costY_M1001_M89_WithFee);
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireX_M1001_M90, expectResAtM90.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(-90));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('18000');
    }); 

    it("2.4 startHasY, result liquidityX == 0, costY < amountY, locPt = rightPt - 1", async function () {

        const rightPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -3250, rightPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, rightPt, 5650, '50000');

        const cp = -1001;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const startState = await getState(pool);
        console.log(startState.currentPoint);
        console.log(startState.liquidity);
        console.log(startState.liquidityX);

        expect(startState.currentPoint).to.equal(String(cp));
        expect(startState.liquidity).to.equal('30000');
        expect(startState.liquidityX).to.equal('30000');

        const costY_M1001_M51 = yInRange('30000', -1001, -51, '1.0001', true);
        const acquireX_M1001_M51 = xInRange('30000', -1001, -51, '1.0001', false);

        const desireX_M1001_M50_NotEnough = stringMinus(xInRange('30000', -1001, -50, '1.0001', false), '1');

        const desireXAtM51 = stringMinus(desireX_M1001_M50_NotEnough, acquireX_M1001_M51);
        const expectResAtM51 = y2xAtLiquidityDesireX(-51, '1.0001', desireXAtM51, '30000', '30000');
        const amountX_M1001_M50_WithFee = getSum([acquireX_M1001_M51, desireXAtM51]);
        const costY_M1001_M50_WithFee = amountAddFee(getSum([costY_M1001_M51, expectResAtM51.costY]));

        const swapResAtCp = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, amountX_M1001_M50_WithFee, 100000);
        expect(swapResAtCp.costY).to.equal(costY_M1001_M50_WithFee);
        expect(swapResAtCp.acquireX).to.equal(getSum([acquireX_M1001_M51, expectResAtM51.acquireX]));

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(-51));
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('1');
    }); 

});