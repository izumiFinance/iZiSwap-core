const { ethers } = require("hardhat");
const BigNumber = require('bignumber.js');

async function getLimOrder(poolAddr, pt) {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    pool = await iZiSwapPool.attach(poolAddr);
    const {sellingX, accEarnX, sellingY, accEarnY, earnX, earnY} = await pool.limitOrderData(pt);
    return {
        sellingX: BigNumber(sellingX._hex),
        accEarnX: BigNumber(accEarnX._hex),
        sellingY: BigNumber(sellingY._hex),
        accEarnY: BigNumber(accEarnY._hex),
        earnX: BigNumber(earnX._hex),
        earnY: BigNumber(earnY._hex)
    }
}

function floor(a) {
    return a.toFixed(0, 3);
}
function ceil(b) {
    return b.toFixed(0, 2);
}
function getAcquiredFee(amount, chargePercent = 50) {
    const originFee = ceil(BigNumber(amount).times(3).div(997));
    const charged = floor(BigNumber(originFee).times(chargePercent).div(100));
    return BigNumber(originFee).minus(charged).toFixed(0);
}

function getFeeCharge(fee, chargePercent = 50) {
    return floor(BigNumber(fee).times(chargePercent).div('100'));
}
module.exports ={
    getLimOrder,
    getAcquiredFee,
    getFeeCharge,
}