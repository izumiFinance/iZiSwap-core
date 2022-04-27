const { ethers } = require("hardhat");
const { getPoolParts } = require("./libraries/funcs.js");

const v = process.argv
const para = {
    receiver: v[2],
}

async function main() {

    console.log("Paramters: ");
    for ( var i in para) { console.log("    " + i + ": " + para[i]); }

    const [deployer] = await ethers.getSigners();
    console.log(deployer.address);
    const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule} = await getPoolParts();

    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    console.log('swapX2YModule: ', swapX2YModule)
    console.log('swapY2XModule: ', swapY2XModule)
    console.log('liquidityModule: ', liquidityModule)
    console.log('limitOrderModule: ', limitOrderModule)
    console.log('flashModule: ', flashModule);

    const factory = await iZiSwapFactory.deploy(para.receiver, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule, flashModule);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})