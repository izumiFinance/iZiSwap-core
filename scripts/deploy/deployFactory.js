const { ethers } = require("hardhat");
const deployed = require("../deployed.js");


const net = process.env.HARDHAT_NETWORK

const swapX2YModule = deployed[net].swapX2YModule;
const swapY2XModule = deployed[net].swapY2XModule;
const liquidityModule = deployed[net].liquidityModule;
const limitOrderModule = deployed[net].limitOrderModule;
const flashModule = deployed[net].flashModule;
const v = process.argv
const para = {
    receiver: v[2],
    defaultFeeChargePercent: v[3]
}

async function main() {
    const feeData = await ethers.provider.getFeeData();
    console.log("Paramters: ");
    for ( var i in para) { console.log("    " + i + ": " + para[i]); }

    const [deployer] = await ethers.getSigners();
    console.log(deployer.address);

    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    console.log('swapX2YModule: ', swapX2YModule)
    console.log('swapY2XModule: ', swapY2XModule)
    console.log('liquidityModule: ', liquidityModule)
    console.log('limitOrderModule: ', limitOrderModule)
    console.log('flashModule: ', flashModule);

    const args = [para.receiver, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule, para.defaultFeeChargePercent]
    console.log('args: ', args)

    const factory = await iZiSwapFactory.deploy(para.receiver, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule, para.defaultFeeChargePercent);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})
