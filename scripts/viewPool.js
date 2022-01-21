const { ethers } = require("hardhat");

async function main() {
    const iZiSwapPool = await ethers.getContractFactory("iZiSwapPool");
    
    var pool = await iZiSwapPool.attach("0xf6c6a9431F34eA89773cF7784f5f41AA61AB71aF");
    [sp, cp, cx, cy, l, a, l] = await pool.state();
    console.log("cp: ", cp);
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