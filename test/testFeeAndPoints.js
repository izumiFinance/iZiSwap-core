const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');

const {getFeeCharge, getPoolParts} = require('./funcs');
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

function floor(a) {
    return BigNumber(a.toFixed(0, 3));
}
function ceil(b) {
    return BigNumber(b.toFixed(0, 2));
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
    return BigNumber(a).times(b).toFixed(0);
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
    return ceil(amount.times(1003).div(1000));
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
describe("swap", function () {
    var signer, miner1, miner2, trader, receiver;
    var poolAddr;
    var pool;
    var testMint;
    var testSwap;
    var q128;
    var expectFeeScaleX, expectFeeScaleX;
    beforeEach(async function() {
        [signer, miner1, miner2, trader, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, 1060);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);


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

        await tokenX.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -2000, 3000, '10000');
        
        const costY_1061_3000_1 = yInRange('10000', 1061, 3000, '1.0001', true);
        const costYFee_1061_3000_1 = getFee(costY_1061_3000_1, 3000);
        const costYWithFee_1061_3000_1 = stringAdd(costY_1061_3000_1, costYFee_1061_3000_1);
        const costYChargeFee_1061_3000_1 = getFeeCharge(costYFee_1061_3000_1);
        const costYAcquireFee_1061_3000_1 = stringMinus(costYFee_1061_3000_1, costYChargeFee_1061_3000_1);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costYWithFee_1061_3000_1, 3000);

        const costX_3000_1061_2 = xInRange('10000', 1061, 3000, '1.0001', true);
        console.log('costX_3000_1061_2: ', costX_3000_1061_2);
        const costXFee_1061_3000_2 = getFee(costX_3000_1061_2, 3000);
        const costXWithFee_1061_3000_2 = stringAdd(costX_3000_1061_2, costXFee_1061_3000_2);
        const costXChargeFee_1061_3000_2 = getFeeCharge(costXFee_1061_3000_2);
        const costXAcquireFee_1061_3000_2 = stringMinus(costXFee_1061_3000_2, costXChargeFee_1061_3000_2);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costXWithFee_1061_3000_2, 1061);

        const costY_1061_2460_3 = yInRange('10000', 1061, 2460, '1.0001', true);
        const costYFee_1061_2460_3 = getFee(costY_1061_2460_3, 3000);
        const costYWithFee_1061_2460_3 = stringAdd(costY_1061_2460_3, costYFee_1061_2460_3);
        const costYChargeFee_1061_2460_3 = getFeeCharge(costYFee_1061_2460_3);
        const costYAcquireFee_1061_2460_3 = stringMinus(costYFee_1061_2460_3, costYChargeFee_1061_2460_3);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costYWithFee_1061_2460_3, 2460);

        q128 = BigNumber(2).pow(128).toFixed(0);

        // console.log('costYAcquireFee_1061_2551_3: ', costY_1061_2551_3
        // );

        const expectFeeScaleY = stringAdd(
            stringDiv(stringMul(costYAcquireFee_1061_3000_1, q128), '10000'),
            stringDiv(stringMul(costYAcquireFee_1061_2460_3, q128), '10000')
        );
        const expectFeeScaleX = stringDiv(stringMul(costXAcquireFee_1061_3000_2, q128), '10000');

        console.log('fee scale y: ', expectFeeScaleY);
        console.log('fee scale x: ', expectFeeScaleX);
        console.log('cost x acc: ', costXAcquireFee_1061_3000_2);

        let feeScaleX_128 = (await pool.feeScaleX_128()).toString();
        expect(feeScaleX_128).to.equal(expectFeeScaleX);
        let feeScaleY_128 = (await pool.feeScaleY_128()).toString();
        expect(feeScaleY_128).to.equal(expectFeeScaleY);

    });
    it("add liquidity leftside of current point", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 2000, '20000');
        const costY_2000_2460_4 = yInRange('10000', 2000, 2460, '1.0001', true);
        const costY_M50_2000_4 = yInRange('30000', -50, 2000, '1.0001', true);
        const costY_M1000_M50_4 = yInRange('30000', -1000, -50, '1.0001', true);
        const costY_M1500_M1000_4 = yInRange('10000', -1500, -1000, '1.0001', true);

        const costYList4 = [costY_M1500_M1000_4, costY_M1000_M50_4, costY_M50_2000_4, costY_2000_2460_4];
        const {feeList: costYFeeList4, feeAcquireList: costYFeeAcquireList4} = getFeeOfList(costYList4, 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -1500);

        let state = await getState(pool);
        expect(state.currentPoint).to.equal('-1500');

        const costX_M1500_M1000_4 = xInRange('10000', -1500, -1000, '1.0001', true);
        const costX_M1000_0_4 = xInRange('30000', -1000, 0, '1.0001', true);
        const costX_0_2000_4 = xInRange('30000', 0, 2000, '1.0001', true);
        const costX_2000_2460_4 = xInRange('10000', 2000, 2460, '1.0001', true);
        const costXList4 = [costX_M1500_M1000_4, costX_M1000_0_4, costX_0_2000_4, costX_2000_2460_4];
        const {feeList: costXFeeList4, feeAcquireList: costXFeeAcquireList4} = getFeeOfList(costXList4, 3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);

        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');

        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 2000);
        await pool.connect(miner1).burn(-1000, 2000, 0);

        const {lastFeeScaleX_128: newScaleX, lastFeeScaleY_128: newScaleY} = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 2000);

        const q256 = BigNumber(2).pow(256).toFixed(0);

        const deltaScaleX = stringLess(newScaleX, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX, q256), lastFeeScaleX_128) : stringMinus(newScaleX, lastFeeScaleX_128);
        const deltaScaleY = stringLess(newScaleY, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY, q256), lastFeeScaleY_128) : stringMinus(newScaleY, lastFeeScaleY_128);

        console.log('deltaScaleX: ', deltaScaleX);
        console.log('deltaScaleY: ', deltaScaleY);

        const expectFeeScaleX = stringAdd(
            stringDiv(stringMul(costXFeeAcquireList4[1], q128), '30000'),
            stringDiv(stringMul(costXFeeAcquireList4[2], q128), '30000')
        );
        const expectFeeScaleY = stringAdd(
            stringDiv(stringMul(costYFeeAcquireList4[1], q128), '30000'),
            stringDiv(stringMul(costYFeeAcquireList4[2], q128), '30000')
        );

        expect(deltaScaleX).to.equal(expectFeeScaleX);
        expect(deltaScaleY).to.equal(expectFeeScaleY);
    });
    it("add liquidity rightside of current point", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2500, 5000, '30000');
        const costY_2460_2500_4 = yInRange('10000', 2460, 2500, '1.0001', true);
        const costY_2500_3000_4 = yInRange('40000', 2500, 3000, '1.0001', true);
        const costY_3000_5000_4 = yInRange('30000', 3000, 5000, '1.0001', true);

        const costYList4 = [costY_2460_2500_4, costY_2500_3000_4, costY_3000_5000_4];
        const {feeList: costYFeeList4, feeAcquireList: costYFeeAcquireList4} = getFeeOfList(costYList4, 3000);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 5000);

        let state = await getState(pool);
        expect(state.currentPoint).to.equal('5000');

        const costX_2460_2500_4 = xInRange('10000', 2460, 2500, '1.0001', true);
        const costX_2500_3000_4 = xInRange('40000', 2500, 3000, '1.0001', true);
        const costX_3000_5000_4 = xInRange('30000', 3000, 5000, '1.0001', true);

        const costXList4 = [costX_2460_2500_4, costX_2500_3000_4, costX_3000_5000_4];
        const {feeList: costXFeeList4, feeAcquireList: costXFeeAcquireList4} = getFeeOfList(costXList4, 3000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);

        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');

        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2500, 5000);
        await pool.connect(miner1).burn(2500, 5000, 0);

        const {lastFeeScaleX_128: newScaleX, lastFeeScaleY_128: newScaleY} = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2500, 5000);

        const q256 = BigNumber(2).pow(256).toFixed(0);

        const deltaScaleX = stringLess(newScaleX, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX, q256), lastFeeScaleX_128) : stringMinus(newScaleX, lastFeeScaleX_128);
        const deltaScaleY = stringLess(newScaleY, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY, q256), lastFeeScaleY_128) : stringMinus(newScaleY, lastFeeScaleY_128);

        console.log('deltaScaleX: ', deltaScaleX);
        console.log('deltaScaleY: ', deltaScaleY);

        const expectFeeScaleX = stringAdd(
            stringDiv(stringMul(costXFeeAcquireList4[1], q128), '40000'),
            stringDiv(stringMul(costXFeeAcquireList4[2], q128), '30000')
        );
        const expectFeeScaleY = stringAdd(
            stringDiv(stringMul(costYFeeAcquireList4[1], q128), '40000'),
            stringDiv(stringMul(costYFeeAcquireList4[2], q128), '30000')
        );

        expect(deltaScaleX).to.equal(expectFeeScaleX);
        expect(deltaScaleY).to.equal(expectFeeScaleY);
    });

    it("add liquidity over current point", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 4000, '40000');
        const costY_999_1000_4 = yInRange('10000', 999, 1000, '1.0001', true);
        const costY_1000_2460_4 = yInRange('50000', 1000, 2460, '1.0001', true);

        const costYList4 = [costY_999_1000_4, costY_1000_2460_4];
        const {feeList: costYFeeList4, feeAcquireList: costYFeeAcquireList4} = getFeeOfList(costYList4, 3000);

        let state = await getState(pool);
        expect(state.liquidityX).to.equal('10000');

        const costXAt_2460_4 = l2x(stringMinus('50000', state.liquidityX), 2460, '1.0001', true);

        const costX_999_1000_4 = xInRange('10000', 999, 1000, '1.0001', true);
        const costX_1000_2461_4 = stringAdd(xInRange('50000', 1000, 2460, '1.0001', true), costXAt_2460_4);

        const costXList4 = [costX_999_1000_4, costX_1000_2461_4];

        console.log("costX_1000_2461_4: ", costX_1000_2461_4);
        console.log('costX_999_1000_4: ', costX_999_1000_4);

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 999);

        state = await getState(pool);
        expect(state.currentPoint).to.equal('999');
        const {feeList: costXFeeList4, feeAcquireList: costXFeeAcquireList4} = getFeeOfList(costXList4, 3000);
        console.log('costXFeeAcquireList4: ', costXFeeAcquireList4)
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);

        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');

        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 4000);
        await pool.connect(miner1).burn(1000, 4000, 0);

        const {lastFeeScaleX_128: newScaleX, lastFeeScaleY_128: newScaleY} = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 4000);

        const q256 = BigNumber(2).pow(256).toFixed(0);

        const deltaScaleX = stringLess(newScaleX, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX, q256), lastFeeScaleX_128) : stringMinus(newScaleX, lastFeeScaleX_128);
        const deltaScaleY = stringLess(newScaleY, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY, q256), lastFeeScaleY_128) : stringMinus(newScaleY, lastFeeScaleY_128);

        console.log('deltaScaleX: ', deltaScaleX);
        console.log('deltaScaleY: ', deltaScaleY);

        const expectFeeScaleX = stringDiv(stringMul(costXFeeAcquireList4[1], q128), '50000');
        const expectFeeScaleY = stringDiv(stringMul(costYFeeAcquireList4[1], q128), '50000');

        expect(deltaScaleX).to.equal(expectFeeScaleX);
        expect(deltaScaleY).to.equal(expectFeeScaleY);
    });

    it("add liquidity with exisiting end point (1)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 2000, '20000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2500, 5000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -1500);
        let state = await getState(pool);
        expect(state.currentPoint).to.equal('-1500');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 4000, '40000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 4210);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('4210');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -500, 1000, '50000');

        const costX_200_1000 = xInRange('80000', 200, 1000, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 200);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('200');
        const costXAcquireFee_200_1000 = getFeeAcquire(getFee(costX_200_1000, '3000'));

        const deltaScale1 = await getDeltaFeeScale(testMint, pool, miner1, -500, 1000);
        expect(deltaScale1.deltaScaleX).to.equal(stringDiv(stringMul(costXAcquireFee_200_1000, q128), '80000'));
        expect(deltaScale1.deltaScaleY).to.equal('0');

        const costX_0_200 = xInRange('80000', 0, 200, '1.0001', true);
        const costX_M500_0 = xInRange('80000', -500, 0, '1.0001', true);
       
        const costXFeeScale_M500_200 = getSum([
            feeScaleFromCost(costX_M500_0, '80000'),
            feeScaleFromCost(costX_0_200, '80000')
        ]);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -800);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('-800');
        const deltaScale2 = await getDeltaFeeScale(testMint, pool, miner1, -500, 1000);
        expect(deltaScale2.deltaScaleX).to.equal(costXFeeScale_M500_200);
        expect(deltaScale2.deltaScaleY).to.equal('0');

        const costY_M500_M50 = yInRange('80000', -500, -50, '1.0001', true);
        const costY_M50_1000 = yInRange('80000', -50, 1000, '1.0001', true);

        const costYFeeScale_M500_1000 = getSum([
            feeScaleFromCost(costY_M500_M50, '80000'),
            feeScaleFromCost(costY_M50_1000, '80000')
        ]);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');
        const deltaScale3 = await getDeltaFeeScale(testMint, pool, miner1, -500, 1000);
        expect(deltaScale3.deltaScaleX).to.equal('0');
        expect(deltaScale3.deltaScaleY).to.equal(costYFeeScale_M500_1000);

    });


    it("add liquidity with exisiting endpoint (1)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 2000, '20000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2500, 5000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -1500);
        let state = await getState(pool);
        expect(state.currentPoint).to.equal('-1500');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 4000, '40000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 4210);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('4210');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -1500);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('-1500');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -500, 1000, '50000');
        //
        // lastFeeScaleX_128:  2068837391660357638882509492443416646402
        // lastFeeScaleY_128:  4035272476368640862826774119690366512368

        const costX_200_1000 = xInRange('80000', 200, 1000, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 200);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('200');
        const costXAcquireFee_200_1000 = getFeeAcquire(getFee(costX_200_1000, '3000'));

        const deltaScale1 = await getDeltaFeeScale(testMint, pool, miner1, -500, 1000);
        expect(deltaScale1.deltaScaleX).to.equal(stringDiv(stringMul(costXAcquireFee_200_1000, q128), '80000'));
        expect(deltaScale1.deltaScaleY).to.equal('0');

        const costX_0_200 = xInRange('80000', 0, 200, '1.0001', true);
        const costX_M500_0 = xInRange('80000', -500, 0, '1.0001', true);
       
        const costXFeeScale_M500_200 = getSum([
            feeScaleFromCost(costX_M500_0, '80000'),
            feeScaleFromCost(costX_0_200, '80000')
        ]);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -800);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('-800');
        const deltaScale2 = await getDeltaFeeScale(testMint, pool, miner1, -500, 1000);
        expect(deltaScale2.deltaScaleX).to.equal(costXFeeScale_M500_200);
        expect(deltaScale2.deltaScaleY).to.equal('0');

        const costY_M500_M50 = yInRange('80000', -500, -50, '1.0001', true);
        const costY_M50_1000 = yInRange('80000', -50, 1000, '1.0001', true);

        const costYFeeScale_M500_1000 = getSum([
            feeScaleFromCost(costY_M500_M50, '80000'),
            feeScaleFromCost(costY_M50_1000, '80000')
        ]);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');
        const deltaScale3 = await getDeltaFeeScale(testMint, pool, miner1, -500, 1000);
        expect(deltaScale3.deltaScaleX).to.equal('0');
        expect(deltaScale3.deltaScaleY).to.equal(costYFeeScale_M500_1000);

    });

    it("add liquidity with existing endpoint and burn some existing liquid during swap (1)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 2000, '20000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 2500, 5000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -1500);
        let state = await getState(pool);
        expect(state.currentPoint).to.equal('-1500');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 4000, '40000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 4210);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('4210');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', -1500);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('-1500');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2460);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1000, 2500, '50000');
        const {lastFeeScaleX_128, lastFeeScaleY_128} = await getAbsFeeScale(testMint, miner1, -500, 1000);
        console.log('lastFeeScaleX_128: ', lastFeeScaleX_128);
        console.log('lastFeeScaleY_128: ', lastFeeScaleY_128);

        state = await getState(pool);
        expect(state.currentPoint).to.equal('2460');
        expect(state.liquidityX).to.equal('50000');
        const costXAt_2460_1 = l2x('50000', 2460, '1.0001', true);
        const costX_2001_2460_1 = xInRange('100000', 2001, 2460, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2001);
        state = await getState(pool);
        expect(state.currentPoint).to.equal('2001');
        const costXFeeScale_2001_2460_1 = feeScaleFromCost(stringAdd(costXAt_2460_1, costX_2001_2460_1), '100000');
        const deltaScale1 = await getDeltaFeeScale(testMint, pool, miner1, 1000, 2500);
        expect(deltaScale1.deltaScaleX).to.equal(costXFeeScale_2001_2460_1);
        expect(deltaScale1.deltaScaleY).to.equal('0');


        const costX_2000_2001_2 = xInRange('100000', 2000, 2001, '1.0001', true);
        const costX_1000_2000_2 = xInRange('120000', 1000, 2000, '1.0001', true);
        const costXFeeScale_2 = getSum([
            feeScaleFromCost(costX_1000_2000_2, '120000'),
            feeScaleFromCost(costX_2000_2001_2, '100000'),
        ]);

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 900);
        const deltaScale2 = await getDeltaFeeScale(testMint, pool, miner1, 1000, 2500);
        expect(deltaScale2.deltaScaleX).to.equal(costXFeeScale_2);
        expect(deltaScale2.deltaScaleY).to.equal('0');

        await pool.connect(miner1).burn(1000, 4000, '40000');

        const liquid4LeftPoint = await getPoint(pool, 1000);
        expect(liquid4LeftPoint.liquidSum).to.equal('50000');
        expect(liquid4LeftPoint.liquidDelta).to.equal('50000');
        expect(liquid4LeftPoint.isEndpt).to.equal(true);

        const costY_1000_2000_3 = yInRange('80000', 1000, 2000, '1.0001', true);
        const costY_2000_2500_3 = yInRange('60000', 2000, 2500, '1.0001', true);
       
        
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2600);
        expect((await getState(pool)).currentPoint).to.equal('2600');

        const costX_2200_2500_4 = xInRange('60000', 2200, 2500, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2200);
        expect((await getState(pool)).currentPoint).to.equal('2200');
        await pool.connect(miner1).burn(2500, 5000, '30000');

        const liquid3RightPoint = await getPoint(pool, 2500);
        expect(liquid3RightPoint.liquidSum).to.equal('50000');
        expect(liquid3RightPoint.liquidDelta).to.equal('-50000');
        expect(liquid3RightPoint.isEndpt).to.equal(true);

        const costX_2000_2200_5 = xInRange('60000', 2000, 2200, '1.0001', true);
        const costX_1000_2000_5 = xInRange('80000', 1000, 2000, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 900);
        expect((await getState(pool)).currentPoint).to.equal('900');

        const costY_1000_1551_6 = yInRange('80000', 1000, 1551, '1.0001', true);

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 1551);
        expect((await getState(pool)).currentPoint).to.equal('1551');
        expect((await getState(pool)).liquidityX).to.equal('80000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 2100, '30000');
        const costYAt1551 = l2y('80000', 1551, '1.0001', true);
        const costY_1551_2000_7 = stringAdd(costYAt1551, yInRange('110000', 1552, 2000, '1.0001', true));
        const costY_2000_2010_7 = yInRange('90000', 2000, 2010, '1.0001', true);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2010);
        expect((await getState(pool)).currentPoint).to.equal('2010');

        await pool.connect(miner1).burn(800, 2100, '20000');
        const costY_2010_2100_8 = yInRange('70000', 2010, 2100, '1.0001', true);
        const costY_2100_2400_8 = yInRange('60000', 2100, 2400, '1.0001', true);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2400);
        expect((await getState(pool)).currentPoint).to.equal('2400');

        await pool.connect(miner1).burn(800, 2100, '10000');
        const costX_2080_2400_9 = xInRange('60000', 2080, 2400, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2080);
        expect((await getState(pool)).currentPoint).to.equal('2080');

        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 1900, 2050, '70000');
        const costX_2050_2080_10 = xInRange('60000', 2050, 2080, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 2050);
        expect((await getState(pool)).currentPoint).to.equal('2050');

        const costX_2000_2050_11 = xInRange('130000', 2000, 2050, '1.0001', true);
        const costX_1900_2000_11 = xInRange('150000', 1900, 2000, '1.0001', true);
        const costX_1500_1900_11 = xInRange('80000', 1500, 1900, '1.0001', true);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 1500);

        const feeScaleX = getSum([
            feeScaleFromCost(costX_2200_2500_4, '60000'),
            feeScaleFromCost(costX_2000_2200_5, '60000'),
            feeScaleFromCost(costX_1000_2000_5, '80000'),
            feeScaleFromCost(costX_2080_2400_9, '60000'),
            feeScaleFromCost(costX_2050_2080_10, '60000'),
            feeScaleFromCost(costX_2000_2050_11, '130000'),
            feeScaleFromCost(costX_1900_2000_11, '150000'),
            feeScaleFromCost(costX_1500_1900_11, '80000'),
        ]);

        const feeScaleY = getSum([
            feeScaleFromCost(costY_1000_2000_3, '80000'),
            feeScaleFromCost(costY_2000_2500_3, '60000'),
            feeScaleFromCost(costY_1000_1551_6, '80000'),
            feeScaleFromCost(costY_1551_2000_7, '110000'),
            feeScaleFromCost(costY_2000_2010_7, '90000'),
            feeScaleFromCost(costY_2010_2100_8, '70000'),
            feeScaleFromCost(costY_2100_2400_8, '60000'),
        ]);

        const deltaFeeScale3 = await getDeltaFeeScale(testMint, pool, miner1, 1000, 2500);
        expect(deltaFeeScale3.deltaScaleX).to.equal(feeScaleX);
        expect(deltaFeeScale3.deltaScaleY).to.equal(feeScaleY);

        await pool.connect(miner1).burn(1000, 2500, '50000');

        const liquid5LeftPoint = await getPoint(pool, 1000);
        const liquid5RightPoint = await getPoint(pool, 2500);
        expect(liquid5LeftPoint.liquidSum).to.equal('0');
        expect(liquid5LeftPoint.liquidDelta).to.equal('0');
        expect(liquid5LeftPoint.isEndpt).to.equal(false);
        expect(liquid5RightPoint.liquidSum).to.equal('0');
        expect(liquid5RightPoint.liquidDelta).to.equal('0');
        expect(liquid5RightPoint.isEndpt).to.equal(false);
    });
});