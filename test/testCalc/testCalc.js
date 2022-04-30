const { expect, use } = require("chai");
const { ethers } = require("hardhat");
const BigNumber = require('bignumber.js');
const {stringMinus, stringDiv, stringAdd} = require('../funcs');

describe("log pow math", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var contract;
    var testDelegate;
    var q128;
    var q256;

    var q255;
    var q127;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, trader, seller, receiver] = await ethers.getSigners();

        const TestCalc = await ethers.getContractFactory("TestCalc");
        contract = await TestCalc.deploy();

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

        q255 = BigNumber(2).pow(255).toFixed(0);
        q127 = BigNumber(2).pow(127).toFixed(0);
    });


    it("test getLogSqrtPrice precision ....", async function () {
        this.timeout(1000000);
        const a = q127;
        const b = q127;
        const a1 = await contract.convertu1282i128(a);
        const b1 = await contract.convertu1282i128(b);
        console.log(a1.toString());
        console.log(b1.toString());
        const c = await contract.addi256(a1.toString(), b1.toString());
        console.log(a.toString());
        console.log(b.toString());
        console.log(c.toString());

    });

});