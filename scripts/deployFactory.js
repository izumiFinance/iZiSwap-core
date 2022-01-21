const { ethers } = require("hardhat");

async function getPoolParts() {
  const iZiSwapPoolPartFactory = await ethers.getContractFactory("SwapX2YModule");
  const iZiSwapPoolPart = await iZiSwapPoolPartFactory.deploy();
  await iZiSwapPoolPart.deployed();
  const iZiSwapPoolPartDesireFactory = await ethers.getContractFactory("SwapY2XModule");
  const iZiSwapPoolPartDesire = await iZiSwapPoolPartDesireFactory.deploy();
  await iZiSwapPoolPartDesire.deployed();
  return [iZiSwapPoolPart.address, iZiSwapPoolPartDesire.address];
}
async function main() {
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");
    [swapX2Y, swapY2X] = await getPoolParts();

    console.log("x2y: ", swapX2Y);
    console.log("y2x: ", swapY2X);
    const factory = await iZiSwapFactory.deploy(swapX2Y, swapY2X);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})