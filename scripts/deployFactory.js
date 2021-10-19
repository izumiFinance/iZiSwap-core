const { ethers } = require("hardhat");

async function getPoolParts() {
  const IzumiswapPoolPartFactory = await ethers.getContractFactory("IzumiswapPoolPart");
  const izumiswapPoolPart = await IzumiswapPoolPartFactory.deploy();
  await izumiswapPoolPart.deployed();
  const IzumiswapPoolPartDesireFactory = await ethers.getContractFactory("IzumiswapPoolPartDesire");
  const izumiswapPoolPartDesire = await IzumiswapPoolPartDesireFactory.deploy();
  await izumiswapPoolPartDesire.deployed();
  return [izumiswapPoolPart.address, izumiswapPoolPartDesire.address];
}
async function main() {
    const IzumiswapFactory = await ethers.getContractFactory("IzumiswapFactory");
    [poolPart, poolPartDesire] = await getPoolParts();

    console.log("pool part: ", poolPart);
    console.log("pool part desire: ", poolPartDesire);
    const factory = await IzumiswapFactory.deploy(poolPart, poolPartDesire);
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})