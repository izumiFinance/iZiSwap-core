const { ethers } = require("hardhat");

const BigNumber = require('bignumber.js');



describe("storage gas cost", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var contract;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, trader, seller, receiver] = await ethers.getSigners();

        const storageGasTestContractFactory = await ethers.getContractFactory("StorageGasTest");
        contract = await storageGasTestContractFactory.deploy();
    });

    it ("test gas cost", async function () {
        let res = await contract.connect(signer).getGasCostOfSave();
        res = await contract.gasUsed();
        console.log('   average gas cost per word new: ', Number(res) / 5);
        await contract.connect(signer).getGasCostOfSave();
        res = await contract.gasUsed();
        console.log('   average gas cost per word reused: ', Number(res) / 5);
    });

    // it ("test gas cost with storage", async function () {
    //     await contract.connect(signer).getGasCostOfSave();
    //     await contract.connect(signer).getGasCostOfReadWithStorage();
    //     const res = await contract.gasUsed();
    //     console.log('   gas cost with storage: ', res);
    // });

    // it ("test gas cost with memory", async function () {
    //     await contract.connect(signer).getGasCostOfSave();
    //     await contract.connect(signer).getGasCostOfReadWithMemory();
    //     const res = await contract.gasUsed();
    //     console.log('   gas cost with memory: ', res);
    // });

    // it ("test gas cost with memory cache", async function () {
    //     await contract.connect(signer).getGasCostOfSave();
    //     await contract.connect(signer).getGasCostOfReadWithMemCache();
    //     const res = await contract.gasUsed();
    //     console.log('   gas cost with memory cache: ', res);
    // });

});