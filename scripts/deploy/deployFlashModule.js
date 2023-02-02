const { ethers } = require("hardhat");

async function main() {
    const feeData = await ethers.provider.getFeeData();

    const FlashModuleFactory = await ethers.getContractFactory('FlashModule');
    const flashModule = await FlashModuleFactory.deploy({
                        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                        maxFeePerGas: feeData.maxFeePerGas,
                        type: 2
                });
    await flashModule.deployed();

    console.log("flashModule addr: " + flashModule.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})
