const { ethers } = require("hardhat");

const contracts = require("./deployed")
const BigNumber = require('bignumber.js')

const Web3 = require("web3");
const secret = require('../.secret.js');
const pk = secret.sk;

const v = process.argv
const net = process.env.HARDHAT_NETWORK

const para = {
    poolAddress: v[2],
    expand: v[3]
}

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

    const poolAddress = para.poolAddress

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