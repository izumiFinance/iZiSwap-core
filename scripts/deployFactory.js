const { ethers } = require("hardhat");

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
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(deployer.address);
    const {swapX2YModule, swapY2XModule, mintModule, limitOrderModule} = await getPoolParts();

    // deploy a factory
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");

    const receiverAddress = '0xa064411B9F927226FB4a99864a247b1ef991b04F';

    console.log('swapX2YModule: ', swapX2YModule)
    console.log('swapY2XModule: ', swapY2XModule)
    console.log('mintModule: ', mintModule)
    console.log('limitOrderModule: ', limitOrderModule)

    const factory = await iZiSwapFactory.deploy(receiverAddress, swapX2YModule, swapY2XModule, mintModule, limitOrderModule);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})