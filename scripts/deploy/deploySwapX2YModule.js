const { ethers } = require("hardhat");

async function main() {
    const feeData = await ethers.provider.getFeeData();
    const SwapX2YModuleFactory = await ethers.getContractFactory("SwapX2YModule");
    const swapX2YModule = await SwapX2YModuleFactory.deploy(
	    {
		    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
		    maxFeePerGas: feeData.maxFeePerGas,
		    type: 2
	    }
    );
    await swapX2YModule.deployed();

    console.log("swapX2YModule addr: " + swapX2YModule.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})
