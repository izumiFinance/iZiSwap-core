const { expect } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');

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
    const IzumiswapPool = await ethers.getContractFactory("IzumiswapPool");
    var pool = await IzumiswapPool.attach(poolAddr);
    await pool.connect(seller).decLimOrderWithX(pt, amountX);
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
    [sellingX, accEarnX, sellingY, accEarnY, earnX, earnY] = await getLimOrder(poolAddr, pt);
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
async function getPoolParts() {
  const IzumiswapPoolPartFactory = await ethers.getContractFactory("IzumiswapPoolPart");
  const izumiswapPoolPart = await IzumiswapPoolPartFactory.deploy();
  await izumiswapPoolPart.deployed();
  const IzumiswapPoolPartDesireFactory = await ethers.getContractFactory("IzumiswapPoolPartDesire");
  const izumiswapPoolPartDesire = await IzumiswapPoolPartDesireFactory.deploy();
  await izumiswapPoolPartDesire.deployed();
  return [izumiswapPoolPart.address, izumiswapPoolPartDesire.address];
}
async function getLimOrder(poolAddr, pt) {
    const IzumiswapPool = await ethers.getContractFactory("IzumiswapPool");
    var pool = await IzumiswapPool.attach(poolAddr);
    [sellingX, accEarnX, sellingY, accEarnY, earnX, earnY] = await pool.limitOrderData(pt);
    return [
        BigNumber(sellingX._hex),
        BigNumber(accEarnX._hex),
        BigNumber(sellingY._hex),
        BigNumber(accEarnY._hex),
        BigNumber(earnX._hex),
        BigNumber(earnY._hex)
    ]
}
async function getStatusVal(poolAddr, pt) {
    const IzumiswapPool = await ethers.getContractFactory("IzumiswapPool");
    var pool = await IzumiswapPool.attach(poolAddr);
    return await pool.statusVal(pt / 50);
}
async function checkStatusVal(eVal, poolAddr, pt) {
    var val = await getStatusVal(poolAddr, pt);
    expect(eVal).to.equal(val);
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
        [signer, seller1, seller2, seller3, trader] = await ethers.getSigners();
        console.log("balance: " + signer.getBalance());
        [poolPart, poolPartDesire] = await getPoolParts();
        // deploy a factory
        const IzumiswapFactory = await ethers.getContractFactory("IzumiswapFactory");
        factory = await IzumiswapFactory.deploy(poolPart, poolPartDesire);
        await factory.deployed();
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

        await tokenY.transfer(trader.address, "100000000000000");
        await tokenY.connect(trader).approve(testSwap.address, "100000000000000");
    });
    it("first claim first earn", async function() {
        sellX1 = BigNumber("1000000000");
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, sellX1.toFixed(0), 5050);
        sellX2 = BigNumber("2000000000");
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, sellX2.toFixed(0), 5050);
        await checkBalance(tokenX, seller1.address, BigNumber(0));
        await checkBalance(tokenY, seller1.address, BigNumber(0));
        await checkBalance(tokenX, seller2.address, BigNumber(0));
        await checkBalance(tokenY, seller2.address, BigNumber(0));

        acquireXExpect = sellX1.plus(sellX2.div(3));
        costY = getCostY(5050, rate, acquireXExpect);
        acquireXExpect = getAcquireX(5050, rate, costY);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costY.toFixed(0), 5051);

        await decLimOrderWithX(poolAddr, seller1, 5050, "500000000");
        seller1EarnPhase1 = getAcquireY(5050, rate, sellX1);
        await checkUserEarn(
            costY,
            BigNumber("0"),
            BigNumber("0"),
            seller1EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            true
        );
        await decLimOrderWithX(poolAddr, seller2, 5050, "10000");
        seller2RemainPhase1 = sellX2.minus(getCostX(5050, rate, costY.minus(getAcquireY(5050, rate, sellX1)))).minus("10000")
        seller2EarnPhase1 = costY.minus(getAcquireY(5050, rate, sellX1));
        await checkUserEarn(
            costY,
            seller2RemainPhase1,
            BigNumber("10000"),
            seller2EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            true
        );
        // phase 2
        sellX1 = BigNumber("1500000000");
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, sellX1.toFixed(0), 5050);
        sellX2 = BigNumber("1500000000");
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, sellX2.toFixed(0), 5050);
        accEarnY = costY.plus("0");
        await checkUserEarn(
            accEarnY,
            sellX1,
            BigNumber("0"),
            seller1EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            true
        );
        sellX2 = seller2RemainPhase1.plus(sellX2);
        await checkUserEarn(
            accEarnY,
            sellX2,
            BigNumber("10000"),
            seller2EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            true
        );

        // trade of phase 2
        acquireXExpect = sellX2.plus(sellX1.div(3));
        costY = getCostY(5050, rate, acquireXExpect);
        acquireXExpect = getAcquireX(5050, rate, costY);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costY.toFixed(0), 5051);
        // seller2 claim first
        await decLimOrderWithX(poolAddr, seller2, 5050, "500000");
        await checkUserEarn(
            accEarnY.plus(costY),
            BigNumber("0"),
            BigNumber("10000"),
            seller2EarnPhase1.plus(getAcquireY(5050, rate, sellX2)),
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            true
        );
        // seller1 claim
        await decLimOrderWithX(poolAddr, seller1, 5050, "1500000000");
        seller1EarnPhase2 = costY.minus(getAcquireY(5050, rate, sellX2));
        seller1SoldPhase2 = getCostX(5050, rate, seller1EarnPhase2);
        seller1DecPhase2 = sellX1.minus(seller1SoldPhase2);
        checkUserEarn(
            accEarnY.plus(costY),
            BigNumber("0"),
            seller1DecPhase2,
            seller1EarnPhase1.plus(seller1EarnPhase2),
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            true
        );
    });
    it("order after swap first could get reward before", async function() {
        sellX1 = BigNumber("1000000000");
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, sellX1.toFixed(0), 5050);
        sellX2 = BigNumber("2000000000");
        await addLimOrderWithX(tokenX, tokenY, seller2, testAddLimOrder, sellX2.toFixed(0), 5050);
        await checkBalance(tokenX, seller1.address, BigNumber(0));
        await checkBalance(tokenY, seller1.address, BigNumber(0));
        await checkBalance(tokenX, seller2.address, BigNumber(0));
        await checkBalance(tokenY, seller2.address, BigNumber(0));

        acquireXExpect = sellX1.plus(sellX2.div(3));
        costY = getCostY(5050, rate, acquireXExpect);
        acquireXExpect = getAcquireX(5050, rate, costY);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costY.toFixed(0), 5051);

        sellX3 = BigNumber("2000000000");
        await addLimOrderWithX(tokenX, tokenY, seller3, testAddLimOrder, sellX3.toFixed(0), 5050);
        await checkBalance(tokenX, seller3.address, BigNumber(0));
        await checkBalance(tokenY, seller3.address, BigNumber(0));
        costY3 = BigNumber("10000");
        acquireXExpect3 = getAcquireX(5050, rate, costY3);
        costY3 = getCostY(5050, rate, acquireXExpect3);
        await testSwap.connect(trader).swapY2X(tokenX.address, tokenY.address, 3000, costY3.toFixed(0), 5051);
        await decLimOrderWithX(poolAddr, seller3, 5050, "20000");
        await checkUserEarn(
            costY.plus(costY3),
            sellX3.minus(getCostX(5050, rate, costY3)).minus(BigNumber("20000")),
            BigNumber("20000"),
            costY3,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller3.address,
            5050,
            true
        );

        await decLimOrderWithX(poolAddr, seller1, 5050, "500000000");
        seller1EarnPhase1 = getAcquireY(5050, rate, sellX1);
        await checkUserEarn(
            costY.plus(costY3),
            BigNumber("0"),
            BigNumber("0"),
            seller1EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            true
        );
        await decLimOrderWithX(poolAddr, seller2, 5050, "10000");
        seller2RemainPhase1 = sellX2.minus(getCostX(5050, rate, costY.minus(getAcquireY(5050, rate, sellX1)))).minus("10000")
        seller2EarnPhase1 = costY.minus(getAcquireY(5050, rate, sellX1));
        await checkUserEarn(
            costY.plus(costY3),
            seller2RemainPhase1,
            BigNumber("10000"),
            seller2EarnPhase1,
            BigNumber("0"),
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            true
        );
    });
});