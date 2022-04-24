const { ethers } = require("hardhat");
const { getPoolParts } = require("./funcs.js");


async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(deployer.address);
    const {swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule} = await getPoolParts();

    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    const receiverAddress = '0xa064411B9F927226FB4a99864a247b1ef991b04F';

    console.log('swapX2YModule: ', swapX2YModule)
    console.log('swapY2XModule: ', swapY2XModule)
    console.log('liquidityModule: ', liquidityModule)
    console.log('limitOrderModule: ', limitOrderModule)

    const factory = await iZiSwapFactory.deploy(receiverAddress, swapX2YModule, swapY2XModule, liquidityModule, limitOrderModule);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})