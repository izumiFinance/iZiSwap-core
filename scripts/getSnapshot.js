const { ethers } = require("hardhat");

async function main() {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    
    var pool = await iZiSwapPool.attach("0xAD15263CC7a034E87f259aDE38D4E4E22a07C250");
    const {currentPoint, liquidity, liquidityX} = await pool.state();
    console.log("currentPoint: ", currentPoint);
    console.log("currX: ", cx.toString());
    console.log('currY: ', cy.toString());
    console.log('tokenX: ', await pool.tokenX());
    console.log('tokenY: ', await pool.tokenY());
    console.log('fee: ', await pool.fee());
}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})