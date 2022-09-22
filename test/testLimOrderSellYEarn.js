const { expect } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');
const { getLimOrder, getPoolParts} = require('./funcs.js');

async function getToken() {

    // deploy token
    const tokenFactory = await ethers.getContractFactory("Token")
    var tokenX = await tokenFactory.deploy('a', 'a');
    await tokenX.deployed();
    var tokenY = await tokenFactory.deploy('b', 'b');
    await tokenY.deployed();

    console.log("tokenX: " + tokenX.address.toLowerCase());
    console.log("tokenY: " + tokenY.address.toLowerCase());

    var txAddr = tokenX.address.toLowerCase();
    var tyAddr = tokenY.address.toLowerCase();

    if (txAddr > tyAddr) {
      tmpAddr = tyAddr;
      tyAddr = txAddr;
      txAddr = tmpAddr;

      tmpToken = tokenY;
      tokenY = tokenX;
      tokenX = tmpToken;
    }
    console.log("txAddr: " + txAddr);
    console.log("tyAddr: " + tyAddr);

    console.log("tx: " + tokenX.address);
    console.log("ty: " + tokenY.address);
    return [tokenX, tokenY];
}

function ceil(b) {
    return BigNumber(b.toFixed(0, 2));
}

function floor(b) {
    return BigNumber(b.toFixed(0, 3));
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
async function decLimOrderWithX(poolAddr, seller, pt, amountX) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    var pool = await iZiSwapPool.attach(poolAddr);
    await pool.connect(seller).decLimOrderWithX(pt, amountX);
}
async function decLimOrderWithY(poolAddr, seller, pt, amountY) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    var pool = await iZiSwapPool.attach(poolAddr);
    await pool.connect(seller).decLimOrderWithY(pt, amountY);
}
function getCostY(point, rate, amountX) {
    var sp = rate.pow(point).sqrt();
    var liquidity = ceil(amountX.times(sp));
    var costY = ceil(liquidity.times(sp));
    return costY;
}
function getCostX(point, rate, amountY) {
    var sp = rate.pow(point).sqrt();
    var liquidity = ceil(amountY.div(sp));
    var costX = ceil(liquidity.div(sp));
    return costX;
}
function getAcquireY(point, rate, amountX) {
    var sp = rate.pow(point).sqrt();
    var liquidity = floor(amountX.times(sp));
    var acquireY = floor(liquidity.times(sp));
    return acquireY;
}
function getAcquireX(point, rate, amountY) {
    var sp = rate.pow(point).sqrt();
    var liquidity = floor(amountY.div(sp));
    var acquireX = floor(liquidity.div(sp));
    return acquireX;
}
function blockNum2BigNumber(blc) {
    return BigNumber(blc._hex);
}
async function checkBalance(token, address, value) {
    expect(blockNum2BigNumber(await token.balanceOf(address)).toFixed(0)).to.equal(value.toFixed(0));
}
async function checkLimOrder(eSellingX, eAccEarnX, eSellingY, eAccEarnY, eEarnX, eEarnY, poolAddr, pt) {
    const {sellingX, accEarnX, sellingY, accEarnY, earnX, earnY} = await getLimOrder(poolAddr, pt);
    expect(sellingX.toFixed(0)).to.equal(eSellingX.toFixed(0));
    expect(accEarnX.toFixed(0)).to.equal(eAccEarnX.toFixed(0));
    expect(sellingY.toFixed(0)).to.equal(eSellingY.toFixed(0));
    expect(accEarnY.toFixed(0)).to.equal(eAccEarnY.toFixed(0));
    expect(earnX.toFixed(0)).to.equal(eEarnX.toFixed(0));
    expect(earnY.toFixed(0)).to.equal(eEarnY.toFixed(0));
}
function list2BigNumber(valueList) {
    var bigList = [];
    for (var i = 0; i < valueList.length; i ++) {
        bigList.push(BigNumber(valueList[i]._hex));
    }
    return bigList;
}
async function getUserEarn(testAddLimOrder, poolAddr, sellerAddr, pt, sellXEarnY) {
    [lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign] = await testAddLimOrder.getEarn(poolAddr, sellerAddr, pt, sellXEarnY);
    return list2BigNumber([lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign]);
}
async function checkUserEarn(
    eLastAccEarn, eSellingRemain, eSellingDesc, eEarn, eEarnAssign,
    testAddLimOrder, poolAddr, sellerAddr, pt, sellXEarnY) {
    [lastAccEarn, sellingRemain, sellingDesc, earn, earnAssign] = await getUserEarn(
        testAddLimOrder, poolAddr, sellerAddr, pt, sellXEarnY
    );
    expect(eLastAccEarn.toFixed(0)).to.equal(lastAccEarn.toFixed(0));
    expect(eSellingRemain.toFixed(0)).to.equal(sellingRemain.toFixed(0));
    expect(eSellingDesc.toFixed(0)).to.equal(sellingDesc.toFixed(0));
    expect(eEarn.toFixed(0)).to.equal(earn.toFixed(0));
    expect(eEarnAssign.toFixed(0)).to.equal(earnAssign.toFixed(0));
}

async function getStatusVal(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    var pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}
async function checkStatusVal(eVal, poolAddr, pt) {
    var val = await getStatusVal(poolAddr, pt);
    expect(eVal).to.equal(val);
}

function amountAddFee(amount) {
    return ceil(amount.times(1000).div(997));
}
describe("LimOrder SellX earn", function () {
    var signer, seller1, seller2, seller3, trader;
    var factory;
    var tokenX, tokenY;
    var poolAddr;
    var rate;
    var testAddLimOrder;
    var testSwap;
    beforeEach(async function() {
        [signer, seller1, seller2, seller3, trader, receiver] = await ethers.getSigners();
        const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule, 50);
        await factory.deployed();
        await factory.enableFeeAmount(3000, 50);
        console.log("factory addr: " + factory.address);
        [tokenX, tokenY] = await getToken();
        txAddr = tokenX.address.toLowerCase();
        tyAddr = tokenY.address.toLowerCase();
        await factory.newPool(txAddr, tyAddr, 3000, 5050);
        poolAddr = await factory.pool(txAddr, tyAddr, 3000);
        rate = BigNumber('1.0001');

        const testAddLimOrderFactory = await ethers.getContractFactory("TestAddLimOrder");
        testAddLimOrder = await testAddLimOrderFactory.deploy(factory.address);
        await testAddLimOrder.deployed();

        const testSwapFactory = await ethers.getContractFactory("TestSwap");
        testSwap = await testSwapFactory.deploy(factory.address);
        await testSwap.deployed();

        await tokenX.transfer(trader.address, "100000000000000");
        await tokenX.connect(trader).approve(testSwap.address, "100000000000000");
    });
    it("first claim first earn", async function() {
        sellY1 = BigNumber("1000000000");
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, sellY1.toFixed(0), 5050);
        sellY2 = BigNumber("2000000000");
        await addLimOrderWithY(tokenX, tokenY, seller2, testAddLimOrder, sellY2.toFixed(0), 5050);
        await checkBalance(tokenX, seller1.address, BigNumber(0));
        await checkBalance(tokenY, seller1.address, BigNumber(0));
        await checkBalance(tokenX, seller2.address, BigNumber(0));
        await checkBalance(tokenY, seller2.address, BigNumber(0));

        acquireYExpect = sellY1.plus(sellY2.div(3));
        costX = getCostX(5050, rate, acquireYExpect);
        let costXWithFee = amountAddFee(costX);
        acquireYExpect = getAcquireY(5050, rate, costX);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costXWithFee.toFixed(0), 5049);

        await decLimOrderWithY(poolAddr, seller1, 5050, "500000000");
        seller1EarnPhase1 = getAcquireX(5050, rate, sellY1);
        await checkUserEarn(
            costX,
            BigNumber("0"),
            BigNumber("0"),
            seller1EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            false
        );
        await decLimOrderWithY(poolAddr, seller2, 5050, "10000");
        seller2RemainPhase1 = sellY2.minus(getCostY(5050, rate, costX.minus(getAcquireX(5050, rate, sellY1)))).minus("10000")
        seller2EarnPhase1 = costX.minus(getAcquireX(5050, rate, sellY1));
        await checkUserEarn(
            costX,
            seller2RemainPhase1,
            BigNumber("10000"),
            seller2EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            false
        );
        // phase 2
        sellY1 = BigNumber("1500000000");
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, sellY1.toFixed(0), 5050);
        sellY2 = BigNumber("1500000000");
        await addLimOrderWithY(tokenX, tokenY, seller2, testAddLimOrder, sellY2.toFixed(0), 5050);
        accEarnX = costX.plus("0");
        await checkUserEarn(
            accEarnX,
            sellY1,
            BigNumber("0"),
            seller1EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            false
        );
        sellY2 = seller2RemainPhase1.plus(sellY2);
        await checkUserEarn(
            accEarnX,
            sellY2,
            BigNumber("10000"),
            seller2EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            false
        );

        // trade of phase 2
        acquireYExpect = sellY2.plus(sellY1.div(3));
        costX = getCostX(5050, rate, acquireYExpect);
        costXWithFee = amountAddFee(costX);
        acquireYExpect = getAcquireY(5050, rate, costX);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costXWithFee.toFixed(0), 5049);
        // seller2 claim first
        await decLimOrderWithY(poolAddr, seller2, 5050, "500000");
        await checkUserEarn(
            accEarnX.plus(costX),
            BigNumber("0"),
            BigNumber("10000"),
            seller2EarnPhase1.plus(getAcquireX(5050, rate, sellY2)),
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            false
        );
        // // seller1 claim
        await decLimOrderWithY(poolAddr, seller1, 5050, "1500000000");
        seller1EarnPhase2 = costX.minus(getAcquireX(5050, rate, sellY2));
        seller1SoldPhase2 = getCostY(5050, rate, seller1EarnPhase2);
        seller1DecPhase2 = sellY1.minus(seller1SoldPhase2);
        checkUserEarn(
            accEarnX.plus(costX),
            BigNumber("0"),
            seller1DecPhase2,
            seller1EarnPhase1.plus(seller1EarnPhase2),
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            false
        );
    });
    it("order after swap first could get reward before", async function() {
        sellY1 = BigNumber("1000000000");
        await addLimOrderWithY(tokenX, tokenY, seller1, testAddLimOrder, sellY1.toFixed(0), 5050);
        sellY2 = BigNumber("2000000000");
        await addLimOrderWithY(tokenX, tokenY, seller2, testAddLimOrder, sellY2.toFixed(0), 5050);
        await checkBalance(tokenX, seller1.address, BigNumber(0));
        await checkBalance(tokenY, seller1.address, BigNumber(0));
        await checkBalance(tokenX, seller2.address, BigNumber(0));
        await checkBalance(tokenY, seller2.address, BigNumber(0));

        acquireYExpect = sellY1.plus(sellY2.div(3));
        costX = getCostX(5050, rate, acquireYExpect);
        const costXWithFee = amountAddFee(costX);
        acquireYExpect = getAcquireY(5050, rate, costX);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costXWithFee.toFixed(0), 5049);

        sellY3 = BigNumber("2000000000");
        await addLimOrderWithY(tokenX, tokenY, seller3, testAddLimOrder, sellY3.toFixed(0), 5050);
        await checkBalance(tokenX, seller3.address, BigNumber(0));
        await checkBalance(tokenY, seller3.address, BigNumber(0));
        costX3 = BigNumber("10000");
        acquireYExpect3 = getAcquireY(5050, rate, costX3);
        costX3 = getCostX(5050, rate, acquireYExpect3);
        const costX3WithFee = amountAddFee(costX3);
        await testSwap.connect(trader).swapX2Y(tokenX.address, tokenY.address, 3000, costX3WithFee.toFixed(0), 5049);
        await decLimOrderWithY(poolAddr, seller3, 5050, "20000");
        await checkUserEarn(
            costX.plus(costX3),
            sellY3.minus(getCostY(5050, rate, costX3)).minus(BigNumber("20000")),
            BigNumber("20000"),
            costX3,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller3.address,
            5050,
            false
        );

        await decLimOrderWithY(poolAddr, seller1, 5050, "500000000");
        seller1EarnPhase1 = getAcquireX(5050, rate, sellY1);
        await checkUserEarn(
            costX.plus(costX3),
            BigNumber("0"),
            BigNumber("0"),
            seller1EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            false
        );
        await decLimOrderWithY(poolAddr, seller2, 5050, "10000");
        seller2RemainPhase1 = sellY2.minus(getCostY(5050, rate, costX.minus(getAcquireX(5050, rate, sellY1)))).minus("10000")
        seller2EarnPhase1 = costX.minus(getAcquireX(5050, rate, sellY1));
        await checkUserEarn(
            costX.plus(costX3),
            seller2RemainPhase1,
            BigNumber("10000"),
            seller2EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            false
        );
    });
});