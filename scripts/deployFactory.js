const { ethers } = require("hardhat");

async function main() {
    const IzumiswapFactory = await ethers.getContractFactory("IzumiswapFactory");

    const factory = await IzumiswapFactory.deploy();
    await factory.deployed();

    console.log("factory addr: " + factory.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})