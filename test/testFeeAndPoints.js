const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');

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

function getFee(cost, fee) {
    return ceil(BigNumber(cost).times(fee).div(1e6)).toFixed(0);
}

function getFeeCharge(fee) {
    return floor(BigNumber(fee).times('20').div('100')).toFixed(0);
}

function getFeeAcquire(fee) {
    const feeCharged = getFeeCharge(fee);
    return stringMinus(fee, feeCharged);
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
function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex);
}
function amountAddFee(amount) {
    return ceil(amount.times(1003).div(1000));
}


async function getPoolParts() {
    const SwapX2YModule = await ethers.getContractFactory('SwapX2YModule');
    const swapX2YModule = await SwapX2YModule.deploy();
    const SwapY2XModule = await ethers.getContractFactory('SwapY2XModule');
    const swapY2XModule = await SwapY2XModule.deploy();
    const MintModule = await ethers.getContractFactory('MintModule');
    const mintModule = await MintModule.deploy();
    return {
        swapX2YModule, swapY2XModule, mintModule
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
    for (const a of amountList) {
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
describe("swap", function () {
    var signer, miner1, miner2, trader, receiver;
    var poolAddr;
    var pool;
    var tokenX, tokenY;
    var testMint;
    var testSwap;
    var q128;
    var expectFeeScaleX, expectFeeScaleX;
    beforeEach(async function() {
        [signer, miner1, miner2, trader, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, mintModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule.address, swapY2XModule.address, mintModule.address);
        await factory.deployed();

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

        const costXAt_2460_4 = stringMinus(l2x('50000', 2460, '1.0001', true),  state.currX);

        const costX_999_1000_4 = xInRange('10000', 999, 1000, '1.0001', true);
        const costX_1000_2461_4 = stringAdd(xInRange('50000', 1000, 2460, '1.0001', true), costXAt_2460_4);

        const costXList4 = [costX_999_1000_4, costX_1000_2461_4];

        console.log("costX_1000_2461_4: ", costX_1000_2461_4);
        console.log('costX_999_1000_4: ', costX_999_1000_4);

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '10000000000000000000', 999);

        state = await getState(pool);
        expect(state.currentPoint).to.equal('999');
        const {feeList: costXFeeList4, feeAcquireList: costXFeeAcquireList4} = getFeeOfList(costXList4, 3000);
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
});