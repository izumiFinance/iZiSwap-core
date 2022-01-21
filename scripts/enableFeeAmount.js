const { ethers } = require("hardhat");

async function main() {
    const iZiSwapFactory = await ethers.getContractFactory("iZiSwapFactory");
    const address = "0xffdb879e011576D74cE4899F40ea5794Ac896bAE";
    const factory = iZiSwapFactory.attach(address);
    await factory.enableFeeAmount(100, 2);
    console.log('fee2pointDelta: ', await factory.fee2pointDelta(100));
}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})