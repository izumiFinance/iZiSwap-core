const { expect, use } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { tree } = require("fp-ts/lib/Tree");
const { gets } = require("fp-ts/lib/StateT");

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
    return ceil(BigNumber(cost).times(fee).div(1e6 - fee)).toFixed(0);
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

function getFeeScaleXInRange(leftPt, rightPt, liquidity, q128) {
    const costX = xInRange(liquidity, leftPt, rightPt, '1.0001', true);
    const feeX = getFeeAcquire(getFee(costX, 3000));
    return stringDiv(stringMul(feeX, q128), liquidity);
}

function getFeeScaleYInRange(leftPt, rightPt, liquidity, q128) {
    const costY = yInRange(liquidity, leftPt, rightPt, '1.0001', true);
    const feeY = getFeeAcquire(getFee(costY, 3000));
    return stringDiv(stringMul(feeY, q128), liquidity);
}

function getFeeScaleXInRangeList(rangeList, q128) {
    const scaleList = [];
    for (range of rangeList) {
        const feeScale = getFeeScaleXInRange(range.leftPt, range.rightPt, range.liquidity, q128);
        scaleList.push(feeScale);
    }
    return getSum(scaleList);
}

function getFeeScaleYInRangeList(rangeList, q128) {
    const scaleList = [];
    for (range of rangeList) {
        const feeScale = getFeeScaleYInRange(range.leftPt, range.rightPt, range.liquidity, q128);
        scaleList.push(feeScale);
    }
    return getSum(scaleList);
}

async function burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner, leftPt, rightPt, q256) {
    const {lastFeeScaleX_128, lastFeeScaleY_128} = await getLiquidity(testMint, miner, tokenX, tokenY, 3000, leftPt, rightPt);

    await pool.connect(miner).burn(leftPt, rightPt, 0);
    const {lastFeeScaleX_128: newScaleX, lastFeeScaleY_128: newScaleY} = await getLiquidity(testMint, miner, tokenX, tokenY, 3000, leftPt, rightPt);

    const deltaScaleX = stringLess(newScaleX, lastFeeScaleX_128) ? stringMinus(stringAdd(newScaleX, q256), lastFeeScaleX_128) : stringMinus(newScaleX, lastFeeScaleX_128);
    const deltaScaleY = stringLess(newScaleY, lastFeeScaleY_128) ? stringMinus(stringAdd(newScaleY, q256), lastFeeScaleY_128) : stringMinus(newScaleY, lastFeeScaleY_128);

    return {deltaScaleX, deltaScaleY};
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
    it("delta < 0, leftFlip, rightFlip, leftNew=0, rightNew!=0(limitOrder)", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1200, '20000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_1 = getFeeScaleXInRangeList([
            {
                leftPt: -1000, rightPt: -200, liquidity: '10000'
            },
            {
                leftPt: -200, rightPt: 0, liquidity: '40000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeY1_1 = getFeeScaleYInRangeList([
            {
                leftPt: -1000, rightPt: -200, liquidity: '10000'
            },
            {
                leftPt: -200, rightPt: -50, liquidity: '40000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeX2_1 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
            {
                leftPt: 1000, rightPt: 1200, liquidity: '20000'
            },
        ], q128);
        const feeY2_1 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
            {
                leftPt: 1000, rightPt: 1200, liquidity: '20000'
            },
        ], q128);

        await addLimOrderWithX(tokenX, tokenY, seller, testAddLimOrder, '2600000', 1000);
        await pool.connect(miner2).burn(-200, 1000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_2 = getFeeScaleXInRangeList([
            {
                leftPt: -1000, rightPt: 0, liquidity: '10000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeY1_2 = getFeeScaleYInRangeList([
            {
                leftPt: -1000, rightPt: -50, liquidity: '10000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeX2_2 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1200, liquidity: '20000'
            },
        ], q128);
        const feeY2_2 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '20000'
            },
            {
                leftPt: 1000, rightPt: 1200, liquidity: '20000'
            },
        ], q128);

        const feeScale1 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, -1000, 100, q256);
        const feeScale2 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, 800, 1200, q256);
        expect(feeScale1.deltaScaleX).to.equal(stringAdd(feeX1_1, feeX1_2));
        expect(feeScale1.deltaScaleY).to.equal(stringAdd(feeY1_1, feeY1_2));
        expect(feeScale2.deltaScaleX).to.equal(stringAdd(feeX2_1, feeX2_2));
        expect(feeScale2.deltaScaleY).to.equal(stringAdd(feeY2_1, feeY2_2));

    });
    
    it("delta < 0, !leftFlip, rightFlip, leftNew!=0, rightNew=0", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -200, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1200, '20000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_1 = getFeeScaleXInRangeList([
            {
                leftPt: -200, rightPt: 0, liquidity: '40000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeY1_1 = getFeeScaleYInRangeList([
            {
                leftPt: -200, rightPt: -50, liquidity: '40000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeX2_1 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
            {
                leftPt: 1000, rightPt: 1200, liquidity: '20000'
            },
        ], q128);
        const feeY2_1 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
            {
                leftPt: 1000, rightPt: 1200, liquidity: '20000'
            },
        ], q128);

        await pool.connect(miner2).burn(-200, 1000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_2 = getFeeScaleXInRangeList([
            {
                leftPt: -200, rightPt: 0, liquidity: '10000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeY1_2 = getFeeScaleYInRangeList([
            {
                leftPt: -200, rightPt: -50, liquidity: '10000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeX2_2 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1200, liquidity: '20000'
            },
        ], q128);
        const feeY2_2 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1200, liquidity: '20000'
            },
        ], q128);

        const feeScale1 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, -200, 100, q256);
        const feeScale2 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, 800, 1200, q256);
        expect(feeScale1.deltaScaleX).to.equal(stringAdd(feeX1_1, feeX1_2));
        expect(feeScale1.deltaScaleY).to.equal(stringAdd(feeY1_1, feeY1_2));
        expect(feeScale2.deltaScaleX).to.equal(stringAdd(feeX2_1, feeX2_2));
        expect(feeScale2.deltaScaleY).to.equal(stringAdd(feeY2_1, feeY2_2));

    });

    it("delta < 0, leftFlip, !rightFlip, leftNew!=0, rightNew!=0", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1000, '20000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_1 = getFeeScaleXInRangeList([
            {
                leftPt: -1000, rightPt: -200, liquidity: '10000'
            },
            {
                leftPt: -200, rightPt: 0, liquidity: '40000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeY1_1 = getFeeScaleYInRangeList([
            {
                leftPt: -1000, rightPt: -200, liquidity: '10000'
            },
            {
                leftPt: -200, rightPt: -50, liquidity: '40000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeX2_1 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
        ], q128);
        const feeY2_1 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
        ], q128);

        await addLimOrderWithY(tokenX, tokenY, seller, testAddLimOrder, '2600000', -200);
        await pool.connect(miner2).burn(-200, 1000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_2 = getFeeScaleXInRangeList([
            {
                leftPt: -1000, rightPt: -200, liquidity: '10000'
            },
            {
                leftPt: -200, rightPt: 0, liquidity: '10000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeY1_2 = getFeeScaleYInRangeList([
            {
                leftPt: -1000, rightPt: -50, liquidity: '10000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeX2_2 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '20000'
            },
        ], q128);
        const feeY2_2 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '20000'
            },
        ], q128);

        const feeScale1 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, -1000, 100, q256);
        const feeScale2 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, 800, 1000, q256);
        expect(feeScale1.deltaScaleX).to.equal(stringAdd(feeX1_1, feeX1_2));
        expect(feeScale1.deltaScaleY).to.equal(stringAdd(feeY1_1, feeY1_2));
        expect(feeScale2.deltaScaleX).to.equal(stringAdd(feeX2_1, feeX2_2));
        expect(feeScale2.deltaScaleY).to.equal(stringAdd(feeY2_1, feeY2_2));

    });

    it("delta < 0, !leftFlip, !rightFlip, leftNew!=0, rightNew!=0", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -200, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1000, '20000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_1 = getFeeScaleXInRangeList([
            {
                leftPt: -200, rightPt: 0, liquidity: '40000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeY1_1 = getFeeScaleYInRangeList([
            {
                leftPt: -200, rightPt: -50, liquidity: '40000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeX2_1 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
        ], q128);
        const feeY2_1 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
        ], q128);

        await pool.connect(miner2).burn(-200, 1000, '30000');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_2 = getFeeScaleXInRangeList([
            {
                leftPt: -200, rightPt: 0, liquidity: '10000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeY1_2 = getFeeScaleYInRangeList([
            {
                leftPt: -200, rightPt: -50, liquidity: '10000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '10000'
            }
        ], q128);
        const feeX2_2 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '20000'
            },
        ], q128);
        const feeY2_2 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '20000'
            },
        ], q128);

        const feeScale1 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, -200, 100, q256);
        const feeScale2 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, 800, 1000, q256);
        expect(feeScale1.deltaScaleX).to.equal(stringAdd(feeX1_1, feeX1_2));
        expect(feeScale1.deltaScaleY).to.equal(stringAdd(feeY1_1, feeY1_2));
        expect(feeScale2.deltaScaleX).to.equal(stringAdd(feeX2_1, feeX2_2));
        expect(feeScale2.deltaScaleY).to.equal(stringAdd(feeY2_1, feeY2_2));

    });

    it("delta = 0, !leftFlip, !rightFlip, leftNew!=0, rightNew!=0", async function () {
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, -1000, 100, '10000');
        await addLiquidity(testMint, miner1, tokenX, tokenY, 3000, 800, 1200, '20000');
        await addLiquidity(testMint, miner2, tokenX, tokenY, 3000, -200, 1000, '30000');
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX1_1 = getFeeScaleXInRangeList([
            {
                leftPt: -1000, rightPt: -200, liquidity: '10000'
            },
            {
                leftPt: -200, rightPt: 0, liquidity: '40000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeY1_1 = getFeeScaleYInRangeList([
            {
                leftPt: -1000, rightPt: -200, liquidity: '10000'
            },
            {
                leftPt: -200, rightPt: -50, liquidity: '40000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '40000'
            }
        ], q128);
        const feeX2_1 = getFeeScaleXInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
            {
                leftPt: 1000, rightPt: 1200, liquidity: '20000'
            },
        ], q128);
        const feeY2_1 = getFeeScaleYInRangeList([
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
            {
                leftPt: 1000, rightPt: 1200, liquidity: '20000'
            },
        ], q128);

        await addLimOrderWithX(tokenX, tokenY, seller, testAddLimOrder, '2600000', 1000);
        await pool.connect(miner2).burn(-200, 1000, '0');

        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', -1500);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 1500);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, '100000000000000000000000', 650);

        const feeX3_1 = getFeeScaleXInRangeList([
            {
                leftPt: -200, rightPt: 0, liquidity: '40000'
            },
            {
                leftPt: 0, rightPt: 100, liquidity: '40000'
            },
            {
                leftPt: 100, rightPt: 650, liquidity: '30000'
            },
            {
                leftPt: 650, rightPt: 800, liquidity: '30000'
            },
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
        ], q128);
        const feeY3_1 = getFeeScaleYInRangeList([
            {
                leftPt: -200, rightPt: -50, liquidity: '40000'
            },
            {
                leftPt: -50, rightPt: 100, liquidity: '40000'
            },
            {
                leftPt: 100, rightPt: 800, liquidity: '30000'
            },
            {
                leftPt: 800, rightPt: 1000, liquidity: '50000'
            },
        ], q128);
        const feeScale1 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, -1000, 100, q256);
        const feeScale2 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner1, 800, 1200, q256);
        const feeScale3 = await burnAndGetFeeScale(pool, testMint, tokenX, tokenY, miner2, -200, 1000, q256);
        expect(feeScale1.deltaScaleX).to.equal(stringMul(feeX1_1, '2'));
        expect(feeScale1.deltaScaleY).to.equal(stringMul(feeY1_1, '2'));
        expect(feeScale2.deltaScaleX).to.equal(stringMul(feeX2_1, '2'));
        expect(feeScale2.deltaScaleY).to.equal(stringMul(feeY2_1, '2'));
        expect(feeScale3.deltaScaleX).to.equal(feeX3_1);
        expect(feeScale3.deltaScaleY).to.equal(feeY3_1);
    });
});