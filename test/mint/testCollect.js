const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");
const { decryptJsonWallet } = require("@ethersproject/json-wallets");
const { poll } = require("@ethersproject/web");

const {getFeeCharge} = require('../funcs');

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
async function getLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr) {
    const ret = await testMint.connect(miner).liquidities(tokenX.address, tokenY.address, fee, pl, pr);
    return {
        liquidity: ret.liquidity.toString(),
        lastFeeScaleX_128: ret.lastFeeScaleX_128.toString(),
        lastFeeScaleY_128: ret.lastFeeScaleY_128.toString(),
        tokenOwedX: ret.tokenOwedX.toString(),
        tokenOwedY: ret.tokenOwedY.toString()
    }
}


async function addLiquidity(testMint, miner, tokenX, tokenY, fee, pl, pr, liquidity) {
    const poolAddr = await testMint.pool(tokenX.address, tokenY.address, fee);
    const balanceXBefore = (await tokenX.balanceOf(miner.address)).toString();
    const balanceYBefore = (await tokenY.balanceOf(miner.address)).toString();
    const balancePoolXBefore = (await tokenX.balanceOf(poolAddr)).toString();
    const balancePoolYBefore = (await tokenY.balanceOf(poolAddr)).toString();
    let ok = false;
    try {
        await testMint.connect(miner).mint(tokenX.address, tokenY.address, fee, pl, pr, liquidity);
        ok = true;
    } catch(err) {
        ok = false;
    }
    const balanceXAfter = (await tokenX.balanceOf(miner.address)).toString();
    const balanceYAfter = (await tokenY.balanceOf(miner.address)).toString();
    const balancePoolXAfter = (await tokenX.balanceOf(poolAddr)).toString();
    const balancePoolYAfter = (await tokenY.balanceOf(poolAddr)).toString();
    return {
        ok,
        payedX: stringMinus(balanceXBefore, balanceXAfter),
        payedY: stringMinus(balanceYBefore, balanceYAfter),
        receivedX: stringMinus(balancePoolXAfter, balancePoolXBefore),
        receivedY: stringMinus(balancePoolYAfter, balancePoolYBefore)
    }

}

async function collect(pool, miner, recipientAddr, leftPt, rightPt, amountXLim, amountYLim) {

    const poolAddr = pool.address;
    const balanceXBefore = (await tokenX.balanceOf(recipientAddr)).toString();
    const balanceYBefore = (await tokenY.balanceOf(recipientAddr)).toString();
    const balancePoolXBefore = (await tokenX.balanceOf(poolAddr)).toString();
    const balancePoolYBefore = (await tokenY.balanceOf(poolAddr)).toString();

    try{
    await pool.connect(miner).collect(miner.address, leftPt, rightPt, amountXLim, amountYLim);
    } catch(err){}
    
    const balanceXAfter = (await tokenX.balanceOf(recipientAddr)).toString();
    const balanceYAfter = (await tokenY.balanceOf(recipientAddr)).toString();
    const balancePoolXAfter = (await tokenX.balanceOf(poolAddr)).toString();
    const balancePoolYAfter = (await tokenY.balanceOf(poolAddr)).toString();
    return {
        collectX: stringMinus(balanceXAfter, balanceXBefore),
        collectY: stringMinus(balanceYAfter, balanceYBefore),
        sendX: stringMinus(balancePoolXBefore, balancePoolXAfter),
        sendY: stringMinus(balancePoolYBefore, balancePoolYAfter)
    }
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

function feeScale2Fee(feeScale, liquidity) {
    const q128 = BigNumber(2).pow(128).toFixed(0);
    return stringDiv(stringMul(feeScale, liquidity), q128);
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
    const pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}

async function getBitsFromPool(poolAddr, idx) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    const pool = await iZiSwapPool.attach(poolAddr);
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
        [signer, miner, miner1, miner2, miner3, trader, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, mintModule, limitOrderModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, mintModule, limitOrderModule);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, 5000);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);

        await tokenX.mint(miner.address, '1000000000000000000000000000000');
        await tokenY.mint(miner.address, '1000000000000000000000000000000');
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

        await tokenX.connect(miner).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner1).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenY.connect(miner2).approve(testMint.address, '1000000000000000000000000000000');
        await tokenX.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '1000000000000000000000000000000');

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

        await addLiquidity(testMint, miner, tokenX, tokenY, 3000, -10000, 10000, '10000');

    });

    it("collect1 ", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -2000);

        await pool.connect(miner1).burn(-4000, 6000, '30000');

        const liquidity1 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        console.log('token owedx: ', liquidity1.tokenOwedX);
        console.log('token owedy: ', liquidity1.tokenOwedY);
        
        const amountXLim = stringAdd(liquidity1.tokenOwedX, '10');
        const amountYLim = stringAdd(liquidity1.tokenOwedY, '20');

        const collect1 = await collect(pool, miner1, miner1.address, -4000, 6000, amountXLim, amountYLim)
        expect(collect1.collectX).to.equal(liquidity1.tokenOwedX)
        expect(collect1.collectY).to.equal(liquidity1.tokenOwedY)
        expect(collect1.sendX).to.equal(liquidity1.tokenOwedX)
        expect(collect1.sendY).to.equal(liquidity1.tokenOwedY)


        const liquidity2 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity2.tokenOwedX).to.equal('0');
        expect(liquidity2.tokenOwedY).to.equal('0');

        const collect2 = await collect(pool, miner1, miner1.address, -4000, 6000, '1000000000000', '100000000000')
        expect(collect2.collectX).to.equal('0')
        expect(collect2.collectY).to.equal('0')
        expect(collect2.sendX).to.equal('0')
        expect(collect2.sendY).to.equal('0')
    });

    it("collect2 ", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -2000);

        await pool.connect(miner1).burn(-4000, 6000, '30000');

        const liquidity1 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        console.log('token owedx: ', liquidity1.tokenOwedX);
        console.log('token owedy: ', liquidity1.tokenOwedY);
        
        const amountXLim = stringMinus(liquidity1.tokenOwedX, '10');
        const amountYLim = stringAdd(liquidity1.tokenOwedY, '20');

        const collect1 = await collect(pool, miner1, miner1.address, -4000, 6000, amountXLim, amountYLim)
        expect(collect1.collectX).to.equal(amountXLim)
        expect(collect1.collectY).to.equal(liquidity1.tokenOwedY)
        expect(collect1.sendX).to.equal(amountXLim)
        expect(collect1.sendY).to.equal(liquidity1.tokenOwedY)


        const liquidity2 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity2.tokenOwedX).to.equal('10');
        expect(liquidity2.tokenOwedY).to.equal('0');

        const collect2 = await collect(pool, miner1, miner1.address, -4000, 6000, '1000000000000', '100000000000')
        expect(collect2.collectX).to.equal('10')
        expect(collect2.collectY).to.equal('0')
        expect(collect2.sendX).to.equal('10')
        expect(collect2.sendY).to.equal('0')

        const liquidity3 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity3.tokenOwedX).to.equal('0');
        expect(liquidity3.tokenOwedY).to.equal('0');

        const collect3 = await collect(pool, miner1, miner1.address, -4000, 6000, '1000000000000', '100000000000')
        expect(collect3.collectX).to.equal('0')
        expect(collect3.collectY).to.equal('0')
        expect(collect3.sendX).to.equal('0')
        expect(collect3.sendY).to.equal('0')
    });

    it("collect3 ", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -2000);

        await pool.connect(miner1).burn(-4000, 6000, '30000');

        const liquidity1 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        console.log('token owedx: ', liquidity1.tokenOwedX);
        console.log('token owedy: ', liquidity1.tokenOwedY);
        
        const amountXLim = stringAdd(liquidity1.tokenOwedX, '10');
        const amountYLim = stringMinus(liquidity1.tokenOwedY, '20');

        const collect1 = await collect(pool, miner1, miner1.address, -4000, 6000, amountXLim, amountYLim)
        expect(collect1.collectX).to.equal(liquidity1.tokenOwedX)
        expect(collect1.collectY).to.equal(amountYLim)
        expect(collect1.sendX).to.equal(liquidity1.tokenOwedX)
        expect(collect1.sendY).to.equal(amountYLim)


        const liquidity2 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity2.tokenOwedX).to.equal('0');
        expect(liquidity2.tokenOwedY).to.equal('20');

        const collect2 = await collect(pool, miner1, miner1.address, -4000, 6000, '1000000000000', '100000000000')
        expect(collect2.collectX).to.equal('0')
        expect(collect2.collectY).to.equal('20')
        expect(collect2.sendX).to.equal('0')
        expect(collect2.sendY).to.equal('20')

        const liquidity3 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity3.tokenOwedX).to.equal('0');
        expect(liquidity3.tokenOwedY).to.equal('0');

        const collect3 = await collect(pool, miner1, miner1.address, -4000, 6000, '1000000000000', '100000000000')
        expect(collect3.collectX).to.equal('0')
        expect(collect3.collectY).to.equal('0')
        expect(collect3.sendX).to.equal('0')
        expect(collect3.sendY).to.equal('0')
    });

    it(" amountX or amountY limit is 0", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -2000);

        await pool.connect(miner1).burn(-4000, 6000, '30000');

        const liquidity1 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        console.log('token owedx: ', liquidity1.tokenOwedX);
        console.log('token owedy: ', liquidity1.tokenOwedY);
        
        const amountXLim = '0'
        const amountYLim = liquidity1.tokenOwedY;

        const collect1 = await collect(pool, miner1, miner1.address, -4000, 6000, amountXLim, amountYLim)
        expect(collect1.collectX).to.equal('0')
        expect(collect1.collectY).to.equal(amountYLim)
        expect(collect1.sendX).to.equal('0')
        expect(collect1.sendY).to.equal(amountYLim)


        const liquidity2 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity2.tokenOwedX).to.equal(liquidity1.tokenOwedX);
        expect(liquidity2.tokenOwedY).to.equal('0');

        const collect2 = await collect(pool, miner1, miner1.address, -4000, 6000, liquidity1.tokenOwedX, '0')
        expect(collect2.collectX).to.equal(liquidity1.tokenOwedX)
        expect(collect2.collectY).to.equal('0')
        expect(collect2.sendX).to.equal(liquidity1.tokenOwedX)
        expect(collect2.sendY).to.equal('0')

        const liquidity3 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity3.tokenOwedX).to.equal('0');
        expect(liquidity3.tokenOwedY).to.equal('0');

        const collect3 = await collect(pool, miner1, miner1.address, -4000, 6000, '10000000000000000', '10000000000000000')
        expect(collect3.collectX).to.equal('0')
        expect(collect3.collectY).to.equal('0')
        expect(collect3.sendX).to.equal('0')
        expect(collect3.sendY).to.equal('0')
    });
    it(" amountX = amountY = 0", async function () {
        const resMiner1 = await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000, '30000');

        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 7000);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -2000);

        await pool.connect(miner1).burn(-4000, 6000, '30000');

        const liquidity1 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        console.log('token owedx: ', liquidity1.tokenOwedX);
        console.log('token owedy: ', liquidity1.tokenOwedY);
        

        const collect1 = await collect(pool, miner1, miner1.address, -4000, 6000, 0, 0)
        expect(collect1.collectX).to.equal('0')
        expect(collect1.collectY).to.equal('0')
        expect(collect1.sendX).to.equal('0')
        expect(collect1.sendY).to.equal('0')


        const liquidity2 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity2.tokenOwedX).to.equal(liquidity1.tokenOwedX);
        expect(liquidity2.tokenOwedY).to.equal(liquidity1.tokenOwedY);

        const collect2 = await collect(pool, miner1, miner1.address, -4000, 6000, '100000', '200000')
        expect(collect2.collectX).to.equal('100000')
        expect(collect2.collectY).to.equal('200000')
        expect(collect2.sendX).to.equal('100000')
        expect(collect2.sendY).to.equal('200000')

        const liquidity3 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity3.tokenOwedX).to.equal(stringMinus(liquidity1.tokenOwedX, '100000'));
        expect(liquidity3.tokenOwedY).to.equal(stringMinus(liquidity1.tokenOwedY, '200000'));

        const collect3 = await collect(pool, miner1, miner1.address, -4000, 6000, '3000000', '4000000')
        expect(collect3.collectX).to.equal('3000000')
        expect(collect3.collectY).to.equal('4000000')
        expect(collect3.sendX).to.equal('3000000')
        expect(collect3.sendY).to.equal('4000000')

        const liquidity4 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity4.tokenOwedX).to.equal(stringMinus(liquidity1.tokenOwedX, '3100000'));
        expect(liquidity4.tokenOwedY).to.equal(stringMinus(liquidity1.tokenOwedY, '4200000'));

        const collect4 = await collect(pool, miner1, miner1.address, -4000, 6000, '30000', '60000')
        expect(collect4.collectX).to.equal('30000')
        expect(collect4.collectY).to.equal('60000')
        expect(collect4.sendX).to.equal('30000')
        expect(collect4.sendY).to.equal('60000')


        const liquidity5 = await getLiquidity(testMint, miner1, tokenX, tokenY, 3000, -4000, 6000);
        expect(liquidity5.tokenOwedX).to.equal(stringMinus(liquidity1.tokenOwedX, '3130000'));
        expect(liquidity5.tokenOwedY).to.equal(stringMinus(liquidity1.tokenOwedY, '4260000'));
    });
});
