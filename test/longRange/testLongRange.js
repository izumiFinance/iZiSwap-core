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
        earn: userEarnBC.earn.toString(),
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

async function swapY2XDesireX(testSwap, trader, tokenX, tokenY, fee, amountX, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapY2XDesireX(tokenX.address, tokenY.address, fee, amountX, lowPt);
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

async function swapX2YDesireY(testSwap, trader, tokenX, tokenY, fee, amountY, lowPt) {
    const traderAmountXBefore = (await tokenX.balanceOf(trader.address)).toString();
    const traderAmountYBefore = (await tokenY.balanceOf(trader.address)).toString();
    await testSwap.connect(trader).swapX2YDesireY(tokenX.address, tokenY.address, fee, amountY, lowPt);
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
    var testCalc;
    var logPowMath;

    var l1, l2, l3, l4, l5;
    beforeEach(async function() {
        [signer, m1, m2, s1, s2, trader, receiver] = await ethers.getSigners();

        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        const testCalcFactory = await ethers.getContractFactory('TestCalc');
        testCalc = await testCalcFactory.deploy();

        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();

        await factory.newPool(txAddr, tyAddr, 3000, 8001);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);

        const TestLogPowMath = await ethers.getContractFactory('TestLogPowMath');
        logPowMath = await TestLogPowMath.deploy();

        await tokenX.mint(s1.address, '100000000000000000000000000000000000');
        await tokenY.mint(s1.address, '100000000000000000000000000000000000');
        await tokenX.mint(s2.address, '100000000000000000000000000000000000');
        await tokenY.mint(s2.address, '100000000000000000000000000000000000');
        
        await tokenX.mint(m1.address, '100000000000000000000000000000000000');
        await tokenY.mint(m1.address, '100000000000000000000000000000000000');
        await tokenX.mint(m2.address, '100000000000000000000000000000000000');
        await tokenY.mint(m2.address, '100000000000000000000000000000000000');

        await tokenX.mint(trader.address, '100000000000000000000000000000000000');
        await tokenY.mint(trader.address, '100000000000000000000000000000000000');

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

        await tokenX.connect(m1).approve(testMint.address, '100000000000000000000000000000000000');
        await tokenY.connect(m1).approve(testMint.address, '100000000000000000000000000000000000');
        await tokenX.connect(m2).approve(testMint.address, '100000000000000000000000000000000000');
        await tokenY.connect(m2).approve(testMint.address, '100000000000000000000000000000000000');
        await tokenX.connect(trader).approve(testSwap.address, '100000000000000000000000000000000000');
        await tokenY.connect(trader).approve(testSwap.address, '100000000000000000000000000000000000');
        await tokenX.connect(s1).approve(testAddLimOrder.address, '100000000000000000000000000000000000');
        await tokenY.connect(s1).approve(testAddLimOrder.address, '100000000000000000000000000000000000');
        await tokenX.connect(s2).approve(testAddLimOrder.address, '100000000000000000000000000000000000');
        await tokenY.connect(s2).approve(testAddLimOrder.address, '100000000000000000000000000000000000');
        

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

        l1 = '1000000000000000000'
        l2 = '2000000000000000000'
        l3 = '3000000000000000000'
        l4 = '3000000000000000000'
        l5 = '3000000000000000000'

    });
    
    it("start with 1.3.3, end with 1.0", async function () {

        this.timeout(1000000);
        await addLiquidity(testMint, m1, tokenX, tokenY, 3000, -120000, -64000, l1)
        await addLiquidity(testMint, m2, tokenX, tokenY, 3000, -89500, -85000, l2)
        await addLiquidity(testMint, m1, tokenX, tokenY, 3000, -29000, 39100, l3)
        await addLiquidity(testMint, m2, tokenX, tokenY, 3000, 64000, 120000, l4)
        await addLiquidity(testMint, m1, tokenX, tokenY, 3000, 110000, 150000, l5)

        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', -119000)
        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', -76500)
        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', -53000)
        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', -45000)
        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', -28000)
        await addLimOrderWithY(tokenX, tokenY, s1, testAddLimOrder, '100000000000000000000', -25600)

        await addLimOrderWithX(tokenX, tokenY, s2, testAddLimOrder, '100000000000000000000', 35000)
        await addLimOrderWithX(tokenX, tokenY, s2, testAddLimOrder, '100000000000000000000', 76800)
        await addLimOrderWithX(tokenX, tokenY, s2, testAddLimOrder, '100000000000000000000', 92000)
        await addLimOrderWithX(tokenX, tokenY, s2, testAddLimOrder, '100000000000000000000', 102400)
        await addLimOrderWithX(tokenX, tokenY, s2, testAddLimOrder, '100000000000000000000', 170000)

        await decLimOrderWithX(s2, testAddLimOrder, '100000000000000000000', 92000, poolAddr)
        await decLimOrderWithX(s2, testAddLimOrder, '100000000000000000000', 102400, poolAddr)
        
        await decLimOrderWithY(s1, testAddLimOrder, '100000000000000000000', -76500, poolAddr)
        await decLimOrderWithY(s1, testAddLimOrder, '100000000000000000000', -45000, poolAddr)
        await decLimOrderWithY(s1, testAddLimOrder, '100000000000000000000', -28000, poolAddr)

        // swap1

        const costY_8002_12750 = (await testCalc.getAmountY(l3, 8002, 12750, true)).toString()
        const acquireX_8002_12750 = (await testCalc.getAmountX(l3, 8002, 12750, false)).toString()

        const costY_12750_25550 = (await testCalc.getAmountY(l3, 12750, 25550, true)).toString()
        const acquireX_12750_25550 = (await testCalc.getAmountX(l3, 12750, 25550, false)).toString()

        const costY_25550_35000 = (await testCalc.getAmountY(l3, 25550, 35000, true)).toString()
        const acquireX_25550_35000 = (await testCalc.getAmountX(l3, 25550, 35000, false)).toString()

        const costY_35000_38350 = (await testCalc.getAmountY(l3, 35000, 38350, true)).toString()
        const acquireX_35000_38350 = (await testCalc.getAmountX(l3, 35000, 38350, false)).toString()

        const costY_38350_39100 = (await testCalc.getAmountY(l3, 38350, 39100, true)).toString()
        const acquireX_38350_39100 = (await testCalc.getAmountX(l3, 38350, 39100, false)).toString()

        const acquireLimXAt35000 = '100000000000000000000'
        const costLimYAt35000 = getCostYFromXAt((await logPowMath.getSqrtPrice(35000)).toString(), acquireLimXAt35000)

        const swap1 = await swapY2X(testSwap, trader, tokenX, tokenY, 3000, '1000000000000000000000000', 39900)
        expect(swap1.acquireX).to.equal(getSum([
            acquireX_8002_12750,
            acquireX_12750_25550,
            acquireX_25550_35000,
            acquireX_35000_38350,
            acquireX_38350_39100,
            acquireLimXAt35000
        ]))
        expect(swap1.costY).to.equal(getSum([
            amountAddFee(costY_8002_12750),
            amountAddFee(costY_12750_25550),
            amountAddFee(costY_25550_35000),
            amountAddFee(costY_35000_38350),
            amountAddFee(costY_38350_39100),
            amountAddFee(costLimYAt35000),
        ]))

        // swap2

        const costY_64000_76750 = (await testCalc.getAmountY(l4, 64000, 76750, true)).toString()
        const acquireX_64000_76750 = (await testCalc.getAmountX(l4, 64000, 76750, false)).toString()

        const costY_76750_76800 = (await testCalc.getAmountY(l4, 76750, 76800, true)).toString()
        const acquireX_76750_76800 = (await testCalc.getAmountX(l4, 76750, 76800, false)).toString()

        const acquireLimXAt76800 = '100000000000000000000'
        const costLimYAt76800 = getCostYFromXAt((await logPowMath.getSqrtPrice(76800)).toString(), acquireLimXAt76800)

        const costY_76800_89550 = (await testCalc.getAmountY(l4, 76800, 89550, true)).toString()
        const acquireX_76800_89550 = (await testCalc.getAmountX(l4, 76800, 89550, false)).toString()

        const costY_89550_102350 = (await testCalc.getAmountY(l4, 89550, 102350, true)).toString()
        const acquireX_89550_102350 = (await testCalc.getAmountX(l4, 89550, 102350, false)).toString()

        const costY_102350_110000 = (await testCalc.getAmountY(l4, 102350, 110000, true)).toString()
        const acquireX_102350_110000 = (await testCalc.getAmountX(l4, 102350, 110000, false)).toString()

        const costY_110000_115150 = (await testCalc.getAmountY(stringAdd(l4, l5), 110000, 115150, true)).toString()
        const acquireX_110000_115150 = (await testCalc.getAmountX(stringAdd(l4, l5), 110000, 115150, false)).toString()


        const costY_115150_120000 = (await testCalc.getAmountY(stringAdd(l4, l5), 115150, 120000, true)).toString()
        const acquireX_115150_120000 = (await testCalc.getAmountX(stringAdd(l4, l5), 115150, 120000, false)).toString()

        const costY_120000_127950 = (await testCalc.getAmountY(l5, 120000, 127950, true)).toString()
        const acquireX_120000_127950 = (await testCalc.getAmountX(l5, 120000, 127950, false)).toString()

        const costY_127950_127960 = (await testCalc.getAmountY(l5, 127950, 127960, true)).toString()
        const acquireX_127950_127960 = (await testCalc.getAmountX(l5, 127950, 127960, false)).toString()

        const costYAt127960 = l2y('299625', (await logPowMath.getSqrtPrice(127960)).toString(), true);
        const acquireXAt127960 = l2x('299625', (await logPowMath.getSqrtPrice(127960)).toString(), false);
        
        const swap2 = await swapY2XDesireX(testSwap, trader, tokenX, tokenY, 3000, 
            getSum([
                acquireX_64000_76750,
                acquireX_76750_76800,
                acquireLimXAt76800,
                acquireX_76800_89550,
                acquireX_89550_102350,
                acquireX_102350_110000,
                acquireX_110000_115150,
                acquireX_115150_120000,
                acquireX_120000_127950,
                acquireX_127950_127960,
                acquireXAt127960
            ])
            , 800000)

        expect(swap2.acquireX).to.equal(getSum([
            acquireX_64000_76750,
            acquireX_76750_76800,
            acquireLimXAt76800,
            acquireX_76800_89550,
            acquireX_89550_102350,
            acquireX_102350_110000,
            acquireX_110000_115150,
            acquireX_115150_120000,
            acquireX_120000_127950,
            acquireX_127950_127960,
            acquireXAt127960
        ]))
        expect(swap2.costY).to.equal(getSum([
            amountAddFee(costY_64000_76750),
            amountAddFee(costY_76750_76800),
            amountAddFee(costLimYAt76800),
            amountAddFee(costY_76800_89550),
            amountAddFee(costY_89550_102350),
            amountAddFee(costY_102350_110000),
            amountAddFee(costY_110000_115150),
            amountAddFee(costY_115150_120000),
            amountAddFee(costY_120000_127950),
            amountAddFee(getSum([costY_127950_127960, costYAt127960]))
        ]))

        const state2 = await getState(pool);
        expect(state2.liquidity).to.equal(l5);
        expect(state2.currentPoint).to.equal('127960')
        expect(state2.liquidityX).to.equal(stringMinus(l5, '299625'))
        // swap3

        const costXAt127960 = l2x('299625', (await logPowMath.getSqrtPrice(127960)).toString(), true);
        const acquireYAt127960 = l2y('299625', (await logPowMath.getSqrtPrice(127960)).toString(), false);

        const costX_120000_127960 = (await testCalc.getAmountX(l5, 120000, 127960, true)).toString()
        const acquireY_120000_127960 = (await testCalc.getAmountY(l5, 120000, 127960, false)).toString()

        const costX_115200_120000 = (await testCalc.getAmountX(stringAdd(l5, l4), 115200, 120000, true)).toString()
        const acquireY_115200_120000 = (await testCalc.getAmountY(stringAdd(l5, l4), 115200, 120000, false)).toString()

        const costX_110000_115200 = (await testCalc.getAmountX(stringAdd(l5, l4), 110000, 115200, true)).toString()
        const acquireY_110000_115200 = (await testCalc.getAmountY(stringAdd(l5, l4), 110000, 115200, false)).toString()

        const costX_102400_110000 = (await testCalc.getAmountX(l4, 102400, 110000, true)).toString()
        const acquireY_102400_110000 = (await testCalc.getAmountY(l4, 102400, 110000, false)).toString()

        const costX_89600_102400 = (await testCalc.getAmountX(l4, 89600, 102400, true)).toString()
        const acquireY_89600_102400 = (await testCalc.getAmountY(l4, 89600, 102400, false)).toString()

        const costX_76800_89600 = (await testCalc.getAmountX(l4, 76800, 89600, true)).toString()
        const acquireY_76800_89600 = (await testCalc.getAmountY(l4, 76800, 89600, false)).toString()

        const costX_64000_76800 = (await testCalc.getAmountX(l4, 64000, 76800, true)).toString()
        const acquireY_64000_76800 = (await testCalc.getAmountY(l4, 64000, 76800, false)).toString()

        const costX_38400_39100 = (await testCalc.getAmountX(l3, 38400, 39100, true)).toString()
        const acquireY_38400_39100 = (await testCalc.getAmountY(l3, 38400, 39100, false)).toString()

        const costX_25600_38400 = (await testCalc.getAmountX(l3, 25600, 38400, true)).toString()
        const acquireY_25600_38400 = (await testCalc.getAmountY(l3, 25600, 38400, false)).toString()

        const costX_12800_25600 = (await testCalc.getAmountX(l3, 12800, 25600, true)).toString()
        const acquireY_12800_25600 = (await testCalc.getAmountY(l3, 12800, 25600, false)).toString()

        const costX_0_12800 = (await testCalc.getAmountX(l3, 0, 12800, true)).toString()
        const acquireY_0_12800 = (await testCalc.getAmountY(l3, 0, 12800, false)).toString()

        const costX_M12800_0 = (await testCalc.getAmountX(l3, -12800, 0, true)).toString()
        const acquireY_M12800_0 = (await testCalc.getAmountY(l3, -12800, 0, false)).toString()

        const costX_M25600_M12800 = (await testCalc.getAmountX(l3, -25600, -12800, true)).toString()
        const acquireY_M25600_M12800 = (await testCalc.getAmountY(l3, -25600, -12800, false)).toString()

        const acquireLimYAtM25600 = '30000000000000000000'
        const costLimXAtM25600 = getCostXFromYAt((await logPowMath.getSqrtPrice(-25600)).toString(), acquireLimYAtM25600)


        const swap3 = await swapX2Y(testSwap, trader, tokenX, tokenY, 3000, 
            getSum([
                amountAddFee(getSum([costXAt127960, costX_120000_127960])),
                amountAddFee(costX_115200_120000),
                amountAddFee(costX_110000_115200),
                amountAddFee(costX_102400_110000),
                amountAddFee(costX_89600_102400),
                amountAddFee(costX_76800_89600),
                amountAddFee(costX_64000_76800),
                amountAddFee(costX_38400_39100),
                amountAddFee(costX_25600_38400),
                amountAddFee(costX_12800_25600),
                amountAddFee(costX_0_12800),
                amountAddFee(costX_M12800_0),
                amountAddFee(costX_M25600_M12800),
                amountAddFee(costLimXAtM25600)
            ])
            , -800000)

        expect(swap3.acquireY).to.equal(getSum([
            acquireYAt127960,
            acquireY_120000_127960,
            acquireY_115200_120000,
            acquireY_110000_115200,
            acquireY_102400_110000,
            acquireY_89600_102400,
            acquireY_76800_89600,
            acquireY_64000_76800,
            acquireY_38400_39100,
            acquireY_25600_38400,
            acquireY_12800_25600,
            acquireY_0_12800,
            acquireY_M12800_0,
            acquireY_M25600_M12800,
            acquireLimYAtM25600
        ]))
        expect(swap3.costX).to.equal(getSum([                
            amountAddFee(getSum([costXAt127960, costX_120000_127960])),
            amountAddFee(costX_115200_120000),
            amountAddFee(costX_110000_115200),
            amountAddFee(costX_102400_110000),
            amountAddFee(costX_89600_102400),
            amountAddFee(costX_76800_89600),
            amountAddFee(costX_64000_76800),
            amountAddFee(costX_38400_39100),
            amountAddFee(costX_25600_38400),
            amountAddFee(costX_12800_25600),
            amountAddFee(costX_0_12800),
            amountAddFee(costX_M12800_0),
            amountAddFee(costX_M25600_M12800),
            amountAddFee(costLimXAtM25600)
        ]))
    
        // swap4

        const acquireLimYAtM25600_4 = '70000000000000000000'
        const costLimXAtM25600_4 = getCostXFromYAt((await logPowMath.getSqrtPrice(-25600)).toString(), acquireLimYAtM25600_4)


        const costX_M29000_M25600 = (await testCalc.getAmountX(l3, -29000, -25600, true)).toString()
        const acquireY_M29000_M25600 = (await testCalc.getAmountY(l3, -29000, -25600, false)).toString()

        const acquireLimYAtM53000 = '100000000000000000000'
        const costLimXAtM53000 = getCostXFromYAt((await logPowMath.getSqrtPrice(-53000)).toString(), acquireLimYAtM53000)

        const costX_M76800_M64000 = (await testCalc.getAmountX(l1, -76800, -64000, true)).toString()
        const acquireY_M76800_M64000 = (await testCalc.getAmountY(l1, -76800, -64000, false)).toString()

        // const acquireLimYAtM76800 = '100000000000000000000'
        // const costLimXAtM76800 = getCostXFromYAt((await logPowMath.getSqrtPrice(-76800)).toString(), acquireLimYAtM76800)

        const costX_M85000_M76800 = (await testCalc.getAmountX(l1, -85000, -76800, true)).toString()
        const acquireY_M85000_M76800 = (await testCalc.getAmountY(l1, -85000, -76800, false)).toString()

        const costX_M89500_M85000 = (await testCalc.getAmountX(stringAdd(l1, l2), -89500, -85000, true)).toString()
        const acquireY_M89500_M85000 = (await testCalc.getAmountY(stringAdd(l1, l2), -89500, -85000, false)).toString()

        const costX_M89600_M89500 = (await testCalc.getAmountX(l1, -89600, -89500, true)).toString()
        const acquireY_M89600_M89500 = (await testCalc.getAmountY(l1, -89600, -89500, false)).toString()

        const costX_M102400_M89600 = (await testCalc.getAmountX(l1, -102400, -89600, true)).toString()
        const acquireY_M102400_M89600 = (await testCalc.getAmountY(l1, -102400, -89600, false)).toString()

        const acquireYAtM102401 = l2y('299971', (await logPowMath.getSqrtPrice(-102401)).toString(), false);
        const costXAtM102401 = l2x('299971', (await logPowMath.getSqrtPrice(-102401)).toString(), true);

console.log('-------------------------------')
        const swap4 = await swapX2YDesireY(testSwap, trader, tokenX, tokenY, 3000, 
            getSum([
                acquireLimYAtM25600_4,
                acquireY_M29000_M25600,
                acquireLimYAtM53000,
                acquireY_M76800_M64000,
                // acquireLimYAtM76800,
                acquireY_M85000_M76800,
                acquireY_M89500_M85000,
                acquireY_M89600_M89500,
                acquireY_M102400_M89600,
                acquireYAtM102401
            ])
            , -800000)
            console.log('-------------------------------')

            console.log('costLimXAtM25600_4: ', costLimXAtM25600_4)
console.log('costX_M29000_M25600: ', costX_M29000_M25600)
console.log('costLimXAtM53000: ', costLimXAtM53000)
console.log('costX_M76800_M64000: ', costX_M76800_M64000)
// console.log('costLimXAtM76800: ', costLimXAtM76800)
console.log('costX_M85000_M76800: ', costX_M85000_M76800)
console.log('costX_M89500_M85000: ', costX_M89500_M85000)
console.log('costX_M89600_M89500: ', costX_M89600_M89500)
console.log('costX_M102400_M89600: ', costX_M102400_M89600)
console.log('costXAtM102401: ', costXAtM102401)
        expect(swap4.acquireY).to.equal(getSum([
            acquireLimYAtM25600_4,
            acquireY_M29000_M25600,
            acquireLimYAtM53000,
            acquireY_M76800_M64000,
            // acquireLimYAtM76800,
            acquireY_M85000_M76800,
            acquireY_M89500_M85000,
            acquireY_M89600_M89500,
            acquireY_M102400_M89600,
            acquireYAtM102401
        ]))
        expect(swap4.costX).to.equal(getSum([
            amountAddFee(costLimXAtM25600_4),
            amountAddFee(costX_M29000_M25600),
            amountAddFee(costLimXAtM53000),
            amountAddFee(costX_M76800_M64000),
            // amountAddFee(costLimXAtM76800),
            amountAddFee(costX_M85000_M76800),
            amountAddFee(costX_M89500_M85000),
            amountAddFee(costX_M89600_M89500),
            amountAddFee(costX_M102400_M89600),
            amountAddFee(costXAtM102401)
        ]))

        const state4 = await getState(pool);
        expect(state4.liquidity).to.equal(l1);
        expect(state4.currentPoint).to.equal('-102401')
        expect(state4.liquidityX).to.equal('299971')
    });
});