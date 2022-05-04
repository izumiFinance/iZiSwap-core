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

    var q24;
    var q23;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, trader, seller, receiver] = await ethers.getSigners();

        const TestCalc = await ethers.getContractFactory("TestCalc");
        contract = await TestCalc.deploy();

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

        q255 = BigNumber(2).pow(255).toFixed(0);
        q127 = BigNumber(2).pow(127).toFixed(0);

        q24 = BigNumber(2).pow(24).toFixed(0);
        q23 = BigNumber(2).pow(23).toFixed(0);
    });


    // it("test getLogSqrtPrice precision ....", async function () {
    //     this.timeout(1000000);
    //     const a = stringMinus(q127, '1');
    //     const b = stringMinus(q127, '1');
    //     const a1 = await contract.convertu1282i128(a);
    //     const b1 = await contract.convertu1282i128(b);
    //     console.log(a1.toString());
    //     console.log(b1.toString());
    //     const c = await contract.addi128(a1.toString(), b1.toString());
    //     console.log(a.toString());
    //     console.log(b.toString());
    //     console.log(c.toString());

    // });

    // it("test liquidity add delta", async function () {
    //     this.timeout(1000000);
        
    //     const a = stringMinus(q127)
    //     const b = '-'+stringMinus(q127, '1');
    //     console.log('q127: ', q127);
    //     const a1 = '0';

    //     console.log('asdfasdf');

    //     // const nb = await contract.negative(b);
    //     // console.log('nb: ', nb);

    //     const c1= await contract.liquidityAddDelta(a, b);
    //     console.log('c1: ', c1.toString());
    // });


    it("test word bit idx", async function () {
        this.timeout(1000000);
        const a = '-' + stringMinus(stringMinus(q23, '0'), '0');
        // const b = '-' + q23;
        
        const [w1, b1] = await contract.wordBitIdx(a);
        // const [w2, b2] = await contract.wordBitIdx(b);

        console.log(a);

        console.log(w1, ' ' , b1);
        // console.log(b);

        // console.log(w2, ' ' , b2);
    });


});