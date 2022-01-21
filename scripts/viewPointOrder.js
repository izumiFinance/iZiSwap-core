const hardhat = require("hardhat");
const { modules } = require("web3");
const contracts = require("./deployed");

const BigNumber = require('bignumber.js');

const Web3 = require("web3");
const secret = require('../.secret.js');
const pk = secret.sk;

const config = require("../hardhat.config.js");

const {getWeb3, getContractABI} = require('./libraries/getWeb3')

const factoryABI = getContractABI(__dirname + '/../artifacts/contracts/iZiSwapFactory.sol/iZiSwapFactory.json');
const poolABI = getContractABI(__dirname + '/../artifacts/contracts/iZiSwapPool.sol/iZiSwapPool.json');
const testAddLimOrderABI = getContractABI(__dirname + '/../artifacts/contracts/test/TestAddLimOrder.sol/TestAddLimOrder.json');

const v = process.argv
const net = process.env.HARDHAT_NETWORK

const rpc = config.networks[net].url
const factoryAddress = contracts[net].factory;
const testAddLimOrderAddress = contracts[net].testAddLimOrder;
var web3 = getWeb3();

//Example: HARDHAT_NETWORK='izumi_test' node viewLimitOrder.js BIT USDC 3000 0x48737f645e1e8dD67CAe1311b2c42e6935c6A5E1 -269200

const para = {
    token0Symbol: v[2],
    token0Address: contracts[net][v[2]],
    token1Symbol: v[3],
    token1Address: contracts[net][v[3]],
    fee: v[4],
    miner: v[5],
    pt: Number(v[6]),
}

async function main() {


  console.log("Paramters: ");
  for ( var i in para) { console.log("    " + i + ": " + para[i]); }

  console.log('factory abi: ', factoryABI);
  
  var factory = new web3.eth.Contract(factoryABI, factoryAddress);

  let poolAddr = await factory.methods.pool(para.token0Address, para.token1Address, para.fee).call();

  console.log('Pool: ', poolAddr);

  var pool = new web3.eth.Contract(poolABI, poolAddr);

  var state = await pool.methods.state().call();
  console.log('state: ', state);

  var tokenX = await pool.methods.tokenX().call();
  console.log('tokenX: ', tokenX);
  var tokenY = await pool.methods.tokenY().call();
  console.log('tokenY: ', tokenY);

  var limitOrderData = await pool.methods.limitOrderData(-269200).call();
  console.log('limit order data: ', limitOrderData);

  var testAddLimOrder = new web3.eth.Contract(testAddLimOrderABI, testAddLimOrderAddress);

  console.log('pt: ', para.pt);
  console.log('miner: ', para.miner);
  console.log('pool: ', poolAddr);
  var userEarnY = await testAddLimOrder.methods.getEarnY(poolAddr, para.miner, para.pt).call();

  console.log('userEarnY: ', userEarnY);
  
}

main().then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
})

module.exports = main;
