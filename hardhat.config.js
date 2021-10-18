require("@nomiclabs/hardhat-waffle");
const secret = require('./.secret.js');
const sk = secret.sk;
const izumiRpcUrl = "http://47.241.103.6:9545";
/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
    ]
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    izumi_test: {
      url: izumiRpcUrl,
      accounts: [sk],
      allowUnlimitedContractSize: true,
    },
  }
};
