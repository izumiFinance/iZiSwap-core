const { ethers } = require("hardhat");

async function main() {

    const feeData = await ethers.provider.getFeeData();
    const SwapY2XModuleFactory = await ethers.getContractFactory("SwapY2XModule");
    const swapY2XModule = await SwapY2XModuleFactory.deploy(
                {
                        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                        maxFeePerGas: feeData.maxFeePerGas,
                        type: 2
                });
    await swapY2XModule.deployed();

    console.log("swapY2XModule addr: " + swapY2XModule.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})
