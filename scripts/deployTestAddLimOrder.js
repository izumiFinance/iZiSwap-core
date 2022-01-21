const { ethers } = require("hardhat");
const contracts = require("./deployed");

const v = process.argv
const net = process.env.HARDHAT_NETWORK

const factoryAddress = contracts[net].factory;

//Example: HARDHAT_NETWORK='izumi_test' node deployTestAddLimOrder.js


async function main() {
    const TestAddLimOrder = await ethers.getContractFactory("TestAddLimOrder");
    const testAddLimOrder = await TestAddLimOrder.deploy(factoryAddress);
    await testAddLimOrder.deployed();

    console.log("testAddLimOrder addr: " + testAddLimOrder.address);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})