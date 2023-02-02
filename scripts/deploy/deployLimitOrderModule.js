const { ethers } = require("hardhat");

async function main() {
    const feeData = await ethers.provider.getFeeData();

    const LimitOrderModuleFactory = await ethers.getContractFactory('LimitOrderModule');
    const limitOrderModule = await LimitOrderModuleFactory.deploy(
	    {
		                        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
		                        maxFeePerGas: feeData.maxFeePerGas,
		                        type: 2
		                }
    );
    await limitOrderModule.deployed();

    console.log("limitOrderModule addr: " + limitOrderModule.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})
