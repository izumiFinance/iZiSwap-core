require("@nomiclabs/hardhat-waffle");
require('hardhat-contract-sizer');
require('@nomiclabs/hardhat-etherscan')
require("@cronos-labs/hardhat-cronoscan")

const secret = require('./.secret.js');
const sk = secret.sk;
const apiKey = secret.apiKey;
const izumiRpcUrl = "http://47.241.103.6:9545";
/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10
          }
        }
      },
    ]
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    izumiTest: {
      url: izumiRpcUrl,
      accounts: [sk],
      // gas: 90000000,
      gasPrice: 100000000000,
    },
    bscTest: {
	    url: 'https://data-seed-prebsc-2-s1.binance.org:8545/',
      accounts: [sk],
      // gas: 90000000,
      gasPrice: 10000000000,
    },
    bsc: {
      url: 'https://bsc-dataseed.binance.org/',
      accounts: [sk],
      // gas: 90000000,
      gasPrice: 5000000000,
    },
    arbitrum: {
      url: 'https://arb1.arbitrum.io/rpc',
      accounts: [sk],
    },
    cronos: {
      url: 'https://evm.cronos.org',
      accounts: [sk],
    },
    aurora: {
      url: 'https://mainnet.aurora.dev',
      accounts: [sk]
    },
    auroraTest: {
      url: 'https://testnet.aurora.dev',
      accounts: [sk],
      gasPrice: 5000000000,
    },
    etc: {
      url: 'https://www.ethercluster.com/etc',
      accounts: [sk],
      gasPrice: 1100000000,
    },
    polygon: {
	    url: 'https://rpc-mainnet.maticvigil.com',
      accounts: [sk],
    },
    zkSyncAlphaTest: {
      url: 'https://zksync2-testnet.zksync.dev',
      accounts: [sk],
    },
    mantleTest: {
      url: 'https://rpc.testnet.mantle.xyz',
      accounts: [sk],
    },
    scrollTestL2: {
      url: 'https://prealpha.scroll.io/l2',
      accounts: [sk],
    },
    icplazaTest: {
      url: 'https://rpctest.ic-plaza.org/',
      accounts: [sk],
    },
    icplaza: {
      url: 'https://rpcmainnet.ic-plaza.org/',
      accounts: [sk],
    },
    syscoin: {
	    url: 'https://rpc.ankr.com/syscoin',
      accounts: [sk],
    },
    syscoinTest: {
	    url: 'https://rpc.tanenbaum.io/',
	    accounts: [sk],
    }
  },
  etherscan: {
    apiKey: apiKey,
  }
};
