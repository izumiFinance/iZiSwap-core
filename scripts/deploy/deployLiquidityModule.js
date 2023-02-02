const { ethers } = require("hardhat");

async function main() {
    const feeData = await ethers.provider.getFeeData();

    const LiquidityModuleFactory = await ethers.getContractFactory('LiquidityModule');
    const liquidityModule = await LiquidityModuleFactory.deploy(
	    {
		                        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
		                        maxFeePerGas: feeData.maxFeePerGas,
		                        type: 2
		                }
    );
    await liquidityModule.deployed();

    console.log("liquidityModule addr: " + liquidityModule.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})
