const Web3 = require("web3");
const config = require("../../hardhat.config.js");

function getWeb3() {
    const net = process.env.HARDHAT_NETWORK
    const rpc = config.networks[net].url
    const web3 = new Web3(new Web3.providers.HttpProvider(rpc));
    return web3;
}

function getContractJson(path) {
    const fs = require('fs');
    let rawdata = fs.readFileSync(path);
    let data = JSON.parse(rawdata);
    return data;
}

function getContractABI(path) {
    const json = getContractJson(path);
    return json.abi;
}

module.exports ={ getWeb3, getContractABI, getContractJson };
