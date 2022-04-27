const { ethers } = require("hardhat");

async function getPoolParts() {
    const SwapX2YModuleFactory = await ethers.getContractFactory("SwapX2YModule");
    const swapX2YModule = await SwapX2YModuleFactory.deploy();
    await swapX2YModule.deployed();
    
    const SwapY2XModuleFactory = await ethers.getContractFactory("SwapY2XModule");
    const swapY2XModule = await SwapY2XModuleFactory.deploy();
    await swapY2XModule.deployed();
  
    const LiquidityModuleFactory = await ethers.getContractFactory('LiquidityModule');
    const liquidityModule = await LiquidityModuleFactory.deploy();
    await liquidityModule.deployed();
  
    const LimitOrderModuleFactory = await ethers.getContractFactory('LimitOrderModule');
    const limitOrderModule = await LimitOrderModuleFactory.deploy();
    await limitOrderModule.deployed();

    const FlashModuleFactory = await ethers.getContractFactory('FlashModule');
    const flashModule = await FlashModuleFactory.deploy();
    await flashModule.deployed();
    return {
      swapX2YModule: swapX2YModule.address,
      swapY2XModule: swapY2XModule.address,
      liquidityModule: liquidityModule.address,
      limitOrderModule: limitOrderModule.address,
      flashModule: flashModule.address,
    };
  }

module.exports ={
    getPoolParts,
}