const { ethers } = require("hardhat");

async function getPoolParts() {
  const iZiSwapPoolPartFactory = await ethers.getContractFactory("SwapX2YModule");
  const iZiSwapPoolPart = await iZiSwapPoolPartFactory.deploy();
  await iZiSwapPoolPart.deployed();
  const iZiSwapPoolPartDesireFactory = await ethers.getContractFactory("SwapY2XModule");
  const iZiSwapPoolPartDesire = await iZiSwapPoolPartDesireFactory.deploy();
  await iZiSwapPoolPartDesire.deployed();
  const MintModuleFactory = await ethers.getContractFactory('MintModule');
  const mintModule = await MintModuleFactory.deploy();
  await mintModule.deployed();
  return [iZiSwapPoolPart.address, iZiSwapPoolPartDesire.address, mintModule.address];
}
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(deployer.address);
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");
    const [swapX2Y, swapY2X, mintModule] = await getPoolParts();

    console.log("x2y: ", swapX2Y);
    console.log("y2x: ", swapY2X);
    console.log('mint: ', mintModule);
    const factory = await iZiSwapFactory.deploy(deployer.address, swapX2Y, swapY2X, mintModule);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})