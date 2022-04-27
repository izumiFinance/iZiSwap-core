const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");
const { getPoolParts } = require('../funcs.js');

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

async function swapX2Y(testSwap, trader, tokenX, tokenY, fee, costX, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, fee, costX, lowPt);
    const traderAmountXAfter = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYAfter = (await tokenY.balanceOf(trader.address)).toString();
    return {
        costX: stringMinus(traderAmountXBefore, traderAmountXAfter),
        acquireY: stringMinus(traderAmountYAfter, traderAmountYBefore),
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

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

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
    it("1.1 leftPt < cp, startHasY, startHasX, result lx < l", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('30000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '50000', '50000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('20000');

        const costXAtCp = l2x('29999', cp, '1.0001', true);
        const costXAtCpWithFee = amountAddFee(costXAtCp);
        const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAtCp, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAtCpWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXAtCpWithFee);
        expect(swapResAtCp.acquireY).to.equal(expectResAtCp.acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(cp));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('49999');
    });
    
    it("1.2 leftPt < cp, startHasY, startHasX, result lx = l, costX >= amountX", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('30000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '50000', '50000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('20000');

        const costXAtCp = l2x('30000', cp, '1.0001', true);
        const costXAtCpWithFee = amountAddFee(costXAtCp);
        const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAtCp, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAtCpWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXAtCpWithFee);
        expect(swapResAtCp.acquireY).to.equal(expectResAtCp.acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(cp));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('50000');
    });

    it("1.3.1 leftPt < cp, startHasY, startHasX, result lx = l, costX < amountX, complete liquidity", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('30000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '50000', '50000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('20000');

        const costXAt2911 = l2x('30000', cp, '1.0001', true);
        const costX_1000_2911 = xInRange('50000', 1000, 2911, '1.0001', true);
        const costXAt999 = l2x('10000', 999, '1.0001', true);

        const costXWithFee_1000_2911 = amountAddFee(stringAdd(costXAt2911, costX_1000_2911));
        const costXWithFee_999 = amountAddFee(costXAt999);
        const costXWithFee = getSum([costXWithFee_999, costXWithFee_1000_2911]);

        const acquireYAt2911 = l2y('30000', cp, '1.0001', false);
        const acquireY_1000_2911 = yInRange('50000', 1000, 2911, '1.0001', false);
        const acquireYAt999 = l2y('10000', 999, '1.0001', false);

        const acquireY = getSum([acquireYAt2911, acquireY_1000_2911, acquireYAt999])

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('999');
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('10000');
    });

    it("1.3.2 leftPt < cp, startHasY, startHasX, result lx = l, costX < amountX, locPt = cp-1", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('30000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '50000', '50000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('20000');

        const amountXAt2911 = l2x('30000', cp, '1.0001', true);
        const amountXAt2910 = stringMinus(l2x('50000', 2911, '1.0001', true), '1');

        const amountXWithFee = amountAddFee(getSum([amountXAt2911, amountXAt2910]))


        const costXAt2911 = l2x('30000', cp, '1.0001', true);
        const expectResAt2910 = x2yAtLiquidity(2910, '1.0001', amountXAt2910, '50000', '0')
        console.log('expectResAt2910: ', expectResAt2910)
        const costXWithFee = amountAddFee(getSum([costXAt2911, expectResAt2910.costX]))

        const acquireYAt2911 = l2y('30000', cp, '1.0001', false);
        const acquireYAt2910 = expectResAt2910.acquireY;

        const acquireY = getSum([acquireYAt2911, acquireYAt2910])

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('2910');
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal(expectResAt2910.liquidityX);
    });

    it("1.3.2 leftPt < cp, startHasY, startHasX, result lx = l, costX < amountX, locPt < cp-1", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('30000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '50000', '50000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('20000');

        const costXAt2911 = l2x('30000', cp, '1.0001', true);
        const costX_1521_2911 = xInRange('50000', 1521, 2911, '1.0001', true);
        const amountXAt1520 = stringMinus(l2x('1', 1520, '1.0001', true), '1');

        const amountXWithFee = amountAddFee(getSum([costXAt2911, costX_1521_2911, amountXAt1520]))

        const costXWithFee = amountAddFee(getSum([costXAt2911, costX_1521_2911]))

        const acquireYAt2911 = l2y('30000', cp, '1.0001', false);
        const acquireY_1521_2911 = yInRange('50000', 1521, 2911, '1.0001', false);

        const acquireY = getSum([acquireYAt2911, acquireY_1521_2911])

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('1520');
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('0');
    });

    it("1.3.2 leftPt < cp, startHasY, startHasX, result lx = l, costX < amountX, locPt == leftPt", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('30000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '50000', '50000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('20000');

        const costXAt2911 = l2x('30000', cp, '1.0001', true);
        const costX_1001_2911 = xInRange('50000', 1001, 2911, '1.0001', true);

        const amountX_1000_2911 = stringMinus(xInRange('50000', 1000, 2911, '1.0001', true), '1');
        const amountXAt1000 = stringMinus(amountX_1000_2911, costX_1001_2911);

        const amountXWithFee = amountAddFee(getSum([costXAt2911, amountX_1000_2911]))

        const expectResAt1000 = x2yAtLiquidity(1000, '1.0001', amountXAt1000, '50000', '0');

        const costXWithFee = amountAddFee(getSum([costXAt2911, costX_1001_2911, expectResAt1000.costX]))

        const acquireYAt2911 = l2y('30000', cp, '1.0001', false);
        const acquireY_1001_2911 = yInRange('50000', 1001, 2911, '1.0001', false);

        const acquireY = getSum([acquireYAt2911, acquireY_1001_2911, expectResAt1000.acquireY])

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('1000');
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal(expectResAt1000.liquidityX);
    });

    it("2.1 leftPt < cp, startHasY, !startHasX, complete liquidity", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAt2911_l10000 = l2y('10000', 2911, '1.0001', true);
        const costYAt2911_l40000 = l2y('40000', 2911, '1.0001', true);
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAt2911_l10000), cp + 1);
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAt2911_l40000), cp + 1);
        
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('0');

        const costX_1000_2912 = xInRange('50000', 1000, 2912, '1.0001', true);
        const costXAt999 = l2x('10000', 999, '1.0001', true);

        const costXWithFee_1000_2912 = amountAddFee(costX_1000_2912);
        const costXWithFee_999 = amountAddFee(costXAt999);
        const costXWithFee = getSum([costXWithFee_999, costXWithFee_1000_2912]);

        const acquireY_1000_2912 = yInRange('50000', 1000, 2912, '1.0001', false);
        const acquireYAt999 = l2y('10000', 999, '1.0001', false);

        const acquireY = getSum([acquireY_1000_2912, acquireYAt999])

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('999');
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal('10000');
    });

    it("2.2 leftPt < cp, startHasY, !startHasX, complete liquidity, locPt = cp", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAt2911_l10000 = l2y('10000', 2911, '1.0001', true);
        const costYAt2911_l40000 = l2y('40000', 2911, '1.0001', true);
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAt2911_l10000), cp + 1);
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAt2911_l40000), cp + 1);
        
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('0');

        const amountXAt2911 = stringMinus(l2x('50000', 2911, '1.0001', true), '1');

        const amountXWithFee = amountAddFee(amountXAt2911)

        const expectResAt2911 = x2yAtLiquidity(2911, '1.0001', amountXAt2911, '50000', '0')
        console.log('expectResAt2911: ', expectResAt2911)
        const costXWithFee = amountAddFee(expectResAt2911.costX)

        const acquireYAt2911 = expectResAt2911.acquireY;

        const acquireY = acquireYAt2911

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('2911');
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal(expectResAt2911.liquidityX);
    });

    it("3.2 leftPt < cp, !startHasY, startHasX, locPt = cp-1", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('50000');

        const amountXAt2910 = l2x('9999', 2910, '1.0001', true)

        const amountXWithFee = amountAddFee(amountXAt2910)

        const expectResAt2910 = x2yAtLiquidity(2910, '1.0001', amountXAt2910, '50000', '0')
        console.log('expectResAt2910: ', expectResAt2910)
        const costXWithFee = amountAddFee(expectResAt2910.costX)

        const acquireYAt2910 = expectResAt2910.acquireY;

        const acquireY = acquireYAt2910

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('2910');
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal(expectResAt2910.liquidityX);
    });

    it("3.3 leftPt < cp, !startHasY, startHasX, locPt < cp-1", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 2911;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('50000');

        const costX_1521_2911 = xInRange('50000', 1521, 2911, '1.0001', true);
        const amountXAt1520 = stringMinus(l2x('1', 1520, '1.0001', true), '1');

        const amountXWithFee = amountAddFee(getSum([costX_1521_2911, amountXAt1520]))

        const costXWithFee = amountAddFee(costX_1521_2911)

        const acquireY_1521_2911 = yInRange('50000', 1521, 2911, '1.0001', false);

        const acquireY = acquireY_1521_2911

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('1520');
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('0');

    });

    it("4.1 leftPt = cp, startHasY, startHasX, result lx < l", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 1000;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('30000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '50000', '50000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('20000');

        const costXAtCp = l2x('10000', cp, '1.0001', true);
        const costXAtCpWithFee = amountAddFee(costXAtCp);
        const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAtCp, '50000', '20000');

        // console.log(expectResAtCp);

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAtCpWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXAtCpWithFee);
        expect(swapResAtCp.acquireY).to.equal(expectResAtCp.acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(cp));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal(expectResAtCp.liquidityX);
    });
    
    it("4.2 leftPt = cp, startHasY, !startHasX, result lx = l, acquireY < desireY", async function () {


        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '90000');

        const cp = 1000;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp = l2y('60000', cp, '1.0001', true);
        const costYAtCpWithFee = amountAddFee(costYAtCp);
        const {costY, acquireX, liquidityX} = y2xAtLiquidity(cp, '1.0001', costYAtCp, '90000', '90000')
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, costYAtCpWithFee, cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('90000');
        expect(state.liquidityX).to.equal('30000');

        const costXAt1000 = l2x('60000', cp, '1.0001', true);
        const acquireYAt1000 = l2y('60000', cp, '1.0001', false);

        const costX_621_1000 = xInRange('30000', 621, 1000, '1.0001', true);
        const acquireY_621_1000 = yInRange('30000', 621, 1000, '1.0001', false);

        const costXAt620 = l2x('21000', 620, '1.0001', true);
        const expectResAt620 = x2yAtLiquidity(620, '1.0001', costXAt620, '30000', '0')
        console.log('expectResAt620: ', expectResAt620)

        const costXWithFee = stringAdd(amountAddFee(costXAt1000), amountAddFee(getSum([costX_621_1000, expectResAt620.costX])))        

        const acquireYAt620 = expectResAt620.acquireY;

        const acquireY = getSum([acquireYAt1000, acquireY_621_1000, acquireYAt620])

        // const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAt2911, '50000', '20000');

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('620');
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal(expectResAt620.liquidityX);
    });
    
    it("5.1 leftPt = cp, startHasY, startHasX, result lx < l", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 1000;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp_l30000 = l2y('30000', cp, '1.0001', true);
        const costYAtCp_l20000 = l2y('20000', cp, '1.0001', true);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAtCp_l30000), cp + 1);
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAtCp_l20000), cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('0');

        const costXAtCp = l2x('20000', cp, '1.0001', true);
        const costXAtCpWithFee = amountAddFee(costXAtCp);
        const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAtCp, '50000', '0');

        console.log(expectResAtCp);

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAtCpWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXAtCpWithFee);
        expect(swapResAtCp.acquireY).to.equal(expectResAtCp.acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(cp));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal(expectResAtCp.liquidityX);
    });

    it("5.2 leftPt = cp, startHasY, startHasX, result lx = l, costX >= amountX", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 1000;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp_l30000 = l2y('30000', cp, '1.0001', true);
        const costYAtCp_l20000 = l2y('20000', cp, '1.0001', true);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAtCp_l30000), cp + 1);
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAtCp_l20000), cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('0');

        const costXAtCp = l2x('50000', cp, '1.0001', true);
        const costXAtCpWithFee = amountAddFee(costXAtCp);
        const expectResAtCp = x2yAtLiquidity(cp, '1.0001', costXAtCp, '50000', '0');

        console.log(expectResAtCp);

        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, costXAtCpWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXAtCpWithFee);
        expect(swapResAtCp.acquireY).to.equal(expectResAtCp.acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal(String(cp));
        expect(state2.liquidity).to.equal('50000');
        expect(state2.liquidityX).to.equal('50000');
    });

    it("5.3 leftPt = cp, startHasY, startHasX, result lx = l, costX > amountX", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 1000;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const costYAtCp_l30000 = l2y('30000', cp, '1.0001', true);
        const costYAtCp_l20000 = l2y('20000', cp, '1.0001', true);
        
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAtCp_l30000), cp + 1);
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, amountAddFee(costYAtCp_l20000), cp + 1);
        const state = await getState(pool);
        console.log(state.currentPoint);
        console.log(state.liquidity);
        console.log(state.liquidityX);

        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('0');

        const costXAt1000 = l2x('50000', cp, '1.0001', true);
        const costX_612_1000 = xInRange('30000', 612, 1000, '1.0001', true);
        const amountXAt611 = l2x('6000', 611, '1.0001', true);

        const amountXWithFee = stringAdd(amountAddFee(costXAt1000), amountAddFee(getSum([costX_612_1000, amountXAt611])))

        const expectResAt611 = x2yAtLiquidity(611, '1.0001', amountXAt611, '30000', '0');
        const costXWithFee = stringAdd(amountAddFee(costXAt1000), amountAddFee(getSum([costX_612_1000, expectResAt611.costX])))

        const acquireYAt1000 = l2y('50000', cp, '1.0001', false);
        const acquireY_612_1000 = yInRange('30000', 612, 1000, '1.0001', false);

        const acquireY = getSum([acquireYAt1000, acquireY_612_1000, expectResAt611.acquireY])


        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('611');
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal(expectResAt611.liquidityX);
    });


    it("6. leftPt = cp, !startHasY, startHasX", async function () {

        const leftPt = 1000;

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1250, leftPt, '30000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, leftPt, 3150, '50000');

        const cp = 1000;
        await testSwap.connect(trader2).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000000', cp);
        const state = await getState(pool);
        expect(state.currentPoint).to.equal(String(cp));
        expect(state.liquidity).to.equal('50000');
        expect(state.liquidityX).to.equal('50000');

        const costX_612_1000 = xInRange('30000', 612, 1000, '1.0001', true);
        const amountXAt611 = l2x('6000', 611, '1.0001', true);

        const amountXWithFee = amountAddFee(getSum([costX_612_1000, amountXAt611]))

        const expectResAt611 = x2yAtLiquidity(611, '1.0001', amountXAt611, '30000', '0');
        const costXWithFee = amountAddFee(getSum([costX_612_1000, expectResAt611.costX]))

        const acquireY_612_1000 = yInRange('30000', 612, 1000, '1.0001', false);

        const acquireY = getSum([acquireY_612_1000, expectResAt611.acquireY])


        const swapResAtCp = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, amountXWithFee, -3000);
        expect(swapResAtCp.costX).to.equal(costXWithFee);
        expect(swapResAtCp.acquireY).to.equal(acquireY);

        const state2 = await getState(pool);
        expect(state2.currentPoint).to.equal('611');
        expect(state2.liquidity).to.equal('30000');
        expect(state2.liquidityX).to.equal(expectResAt611.liquidityX);
    });
});