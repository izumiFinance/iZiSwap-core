const { ethers } = require("hardhat");

const contracts = require("./deployed")

const Web3 = require("web3");
const secret = require('../.secret.js');
const pk = secret.sk;

const v = process.argv
const net = process.env.HARDHAT_NETWORK

const para = {
    symbolA: v[2],
    tokenA: contracts[net][v[2]],
    symbolB: v[3],
    tokenB: contracts[net][v[3]],
    fee: v[4],
    expand: v[5]
}

const factoryAddress = contracts[net].factory;
const factoryABI = [
    {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint24",
            "name": "",
            "type": "uint24"
          }
        ],
        "name": "pool",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
    }
]
const poolABI = [
    {
        "inputs": [
          {
            "internalType": "uint16",
            "name": "newNextQueueLen",
            "type": "uint16"
          }
        ],
        "name": "expandObservationQueue",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

const config = require("../hardhat.config.js")
const rpc = config.networks[net].url
var web3 = new Web3(new Web3.providers.HttpProvider(rpc))

async function main() {

    for ( var i in para) { console.log("    " + i + ": " + para[i]); }
    const factory = new web3.eth.Contract(factoryABI, factoryAddress);

    const poolAddress = await factory.methods.pool(para.tokenA, para.tokenB, para.fee).call()

    const pool = new web3.eth.Contract(poolABI, poolAddress)

    const expandObservationQueueCalling = pool.methods.expandObservationQueue(para.expand)

    const gasLimit = await expandObservationQueueCalling.estimateGas()
    console.log('gas limit: ', gasLimit)

    const signedTx = await web3.eth.accounts.signTransaction(
        {
            to: poolAddress,
            data: expandObservationQueueCalling.encodeABI(),
            gas: new BigNumber(gasLimit * 1.1).toFixed(0, 2),
        }, 
        pk
    )
    // nonce += 1;
    const tx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    console.log('tx: ', tx);

}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})