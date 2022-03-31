const { expect } = require("chai");
const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');

async function getToken() {

    // deploy token
    const tokenFactory = await ethers.getContractFactory("Token")
    tokenX = await tokenFactory.deploy('a', 'a');
    await tokenX.deployed();
    tokenY = await tokenFactory.deploy('b', 'b');
    await tokenY.deployed();

    console.log("tokenX: " + tokenX.address.toLowerCase());
    console.log("tokenY: " + tokenY.address.toLowerCase());

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
function getCostY(point, rate, amountX) {
    sp = rate.pow(point).sqrt();
    liquidity = ceil(amountX.times(sp));
    costY = ceil(liquidity.times(sp));

    liquidity = floor(costY.div(sp));
    acquireX = floor(liquidity.div(sp));
    return [acquireX, costY];
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
    bigList = [];
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
async function getLimOrder(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
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
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    return await pool.orderOrEndpoint(pt / 50);
}
async function checkStatusVal(eVal, poolAddr, pt) {
    val = await getStatusVal(poolAddr, pt);
    expect(eVal).to.equal(val);
}
describe("LimOrder SellY Offset SellX", function () {
    var signer, seller1, seller2, seller3, trader;
    var factory;
    var tokenX, tokenY;
    var poolAddr;
    var rate;
    var testAddLimOrder;
    beforeEach(async function() {
        [signer, seller1, seller2, seller3, trader, receiver] = await ethers.getSigners();
        const {swapX2YModule, swapY2XModule, mintModule, limitOrderModule} = await getPoolParts();
        // deploy a factory
        const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");
        const factory = await iZiSwapFactory.deploy(receiver.address, swapX2YModule, swapY2XModule, mintModule, limitOrderModule);
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
    });
    it("selly should offset sellx, when amountY over", async function() {
        sellX = BigNumber("1000000000");
        [acquireX, costY] = getCostY(5050, rate, sellX);
        sellX = acquireX;
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, sellX.toFixed(0), 5050);
        remainY = BigNumber("2000000");
        sellY = costY.plus(remainY);
        await addLimOrderWithY(tokenX, tokenY, seller2, testAddLimOrder, sellY.toFixed(0), 5050);
        await checkBalance(tokenX, seller1.address, BigNumber(0));
        await checkBalance(tokenY, seller1.address, BigNumber(0));
        await checkBalance(tokenX, seller2.address, BigNumber(0));
        await checkBalance(tokenY, seller2.address, BigNumber(0));

        await checkLimOrder(
            BigNumber("0"),
            BigNumber("0"),
            remainY,
            costY,
            BigNumber("0"),
            costY,
            poolAddr,
            5050
        );
        await checkUserEarn(
            BigNumber('0'),
            remainY,
            BigNumber('0'),
            BigNumber('0'),
            sellX,
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            false
        );
        await checkUserEarn(
            BigNumber('0'),
            sellX,
            BigNumber('0'),
            BigNumber('0'),
            BigNumber('0'),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            true
        );
        await checkStatusVal(2, poolAddr, 5050);
    });
    it("sellx should offset selly, when amountX over", async function() {

        sellX = BigNumber("1000000000");
        [acquireX,costY] = getCostY(5050, rate, sellX);
        sellX = acquireX.plus(BigNumber("2000000"));
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, sellX.toFixed(0), 5050);
        await addLimOrderWithY(tokenX, tokenY, seller2, testAddLimOrder, costY.toFixed(0), 5050);
        await checkBalance(tokenX, seller1.address, BigNumber(0));
        await checkBalance(tokenY, seller1.address, BigNumber(0));
        await checkBalance(tokenX, seller2.address, BigNumber(0));
        await checkBalance(tokenY, seller2.address, BigNumber(0));

        await checkLimOrder(
            BigNumber("2000000"),
            BigNumber("0"),
            BigNumber("0"),
            costY,
            BigNumber("0"),
            costY,
            poolAddr,
            5050
        );
        await checkUserEarn(
            BigNumber('0'),
            BigNumber('0'),
            BigNumber('0'),
            BigNumber('0'),
            acquireX,
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            false
        );
        await checkUserEarn(
            BigNumber('0'),
            sellX,
            BigNumber('0'),
            BigNumber('0'),
            BigNumber('0'),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            true
        );
        await checkStatusVal(2, poolAddr, 5050);
    });
    it("sellx should offset selly, exactly", async function() {

        
        sellX = BigNumber("1000000000");
        [acquireX,costY] = getCostY(5050, rate, sellX);
        sellX = acquireX.plus("0");
        await addLimOrderWithX(tokenX, tokenY, seller1, testAddLimOrder, sellX.toFixed(0), 5050);
        await addLimOrderWithY(tokenX, tokenY, seller2, testAddLimOrder, costY.toFixed(0), 5050);
        await checkBalance(tokenX, seller1.address, BigNumber(0));
        await checkBalance(tokenY, seller1.address, BigNumber(0));
        await checkBalance(tokenX, seller2.address, BigNumber(0));
        await checkBalance(tokenY, seller2.address, BigNumber(0));

        await checkLimOrder(
            BigNumber("0"),
            BigNumber("0"),
            BigNumber("0"),
            costY,
            BigNumber("0"),
            costY,
            poolAddr,
            5050
        );
        await checkUserEarn(
            BigNumber('0'),
            BigNumber('0'),
            BigNumber('0'),
            BigNumber('0'),
            acquireX,
            testAddLimOrder,
            poolAddr,
            seller2.address,
            5050,
            false
        );
        await checkUserEarn(
            BigNumber('0'),
            sellX,
            BigNumber('0'),
            BigNumber('0'),
            BigNumber('0'),
            testAddLimOrder,
            poolAddr,
            seller1.address,
            5050,
            true
        );
        await checkStatusVal(0, poolAddr, 5050);
    });
});