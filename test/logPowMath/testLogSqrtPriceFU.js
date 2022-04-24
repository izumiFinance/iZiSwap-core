const { expect, use } = require("chai");
const { ethers } = require("hardhat");
const BigNumber = require('bignumber.js');


describe("log pow math", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var contract;
    var q128;
    var q256;
    beforeEach(async function() {
        [signer, miner1, miner2, miner3, trader, seller, receiver] = await ethers.getSigners();

        const logPowMathContractFactory = await ethers.getContractFactory("LogPowMathTest");
        contract = await logPowMathContractFactory.deploy();

        q256 = BigNumber(2).pow(256).toFixed(0);
        q128 = BigNumber(2).pow(128).toFixed(0);

    });

    it ("test gas cost", async function () {
        const res = (await contract.getGasCostOfGetSqrtPrice(-70010)).toString();
        console.log('   gas cost: ', res);
    });

    // it("test getLogSqrtPrice precision ....", async function () {
    //     const res = (await contract.getSqrtPrice(700000)).toString();
    //     //const a = (new BigNumber(1.0001).pow(-8000)).pow(10).pow(10).sqrt().times(2**96);
    //     const a = (new BigNumber(1.0001 ** (700000))).sqrt().times(2**96).toFixed(0);

    //     console.log(a);
    //     console.log(res);
    //     console.log(2**(-96));

    // });

    // it("test first getSqrtPrice and then log ....", async function () {
    //     for (var i=700001; i< 800000; i ++) {
    //         if (i % 1000 === 0){
    //             console.log(i);
    //         }
    //         //   const a = await contract.getSqrtPrice(i);
    //         //   const res = await contract.getLogSqrtPriceFU(a);
    //         //   expect(res[0]).to.equal(i-1);
    //         //   expect(res[0] + 1).to.equal(res[1]);

    //           let a2 = await contract.getSqrtPrice(-i);
    //           a2 = new BigNumber(a2.toString()).div(1.0001 ** 0.499999);
    //           const res2 = await contract.getLogSqrtPriceFU(a2.toFixed(0));
    //           const res3 = await contract.getSqrtPrice(res2[0]);
    //           if (new BigNumber(res3.toString()) > a2) {
    //               console.log(a2.toFixed(0));
    //               console.log(res3.toString());
    //               console.log(i);
    //           }
    //     }

    //     // const res = await contract.getSqrtPrice(400000);
    //     // //const a = (new BigNumber(1.0001).pow(-8000)).pow(10).pow(10).sqrt().times(2**96);
    //     // const a = (new BigNumber(1.0001 ** (400000))).sqrt().times(2**96);
    //     // console.log(a);
    //     // console.log(res);
    // });

    // it("test first getSqrtPrice and then log ....", async function () {
    //     for (var i=700001; i< 800000; i ++) {
    //         if (i % 1000 === 0){
    //             console.log(i);
    //         }
    //         //   const a = await contract.getSqrtPrice(i);
    //         //   const res = await contract.getLogSqrtPriceFU(a);
    //         //   expect(res[0]).to.equal(i-1);
    //         //   expect(res[0] + 1).to.equal(res[1]);

    //           let a2 = await contract.getSqrtPrice(-i);
    //           a2 = new BigNumber(a2.toString()).div(1.0001 ** 0.499999);
    //           const res2 = await contract.getLogSqrtPriceFU(a2.toFixed(0));
    //           const res3 = await contract.getSqrtPrice(res2[0]);
    //           if (new BigNumber(res3.toString()) > a2) {
    //               console.log(a2.toFixed(0));
    //               console.log(res3.toString());
    //               console.log(i);
    //           }
    //     }

    //     // const res = await contract.getSqrtPrice(400000);
    //     // //const a = (new BigNumber(1.0001).pow(-8000)).pow(10).pow(10).sqrt().times(2**96);
    //     // const a = (new BigNumber(1.0001 ** (400000))).sqrt().times(2**96);
    //     // console.log(a);
    //     // console.log(res);
    // });

    // it("test getLogSqrtPrice directly from 1.0001^i ....", async function () {
    //     // fail at -650727
    //     for (var i=0; i< 800000; i ++) {
    //         if (i % 1000 === 0){
    //             console.log(i);
    //         }
    //           const res = await contract.getLogSqrtPriceFU((new BigNumber(1.0001 ** i).sqrt().times(2**96)).toFixed(0));
    //           expect(res[0]).to.equal(i-1);
    //           //expect(res[0] + 1).to.equal(res[1]);

    //           const res2 = await contract.getLogSqrtPriceFU((new BigNumber(1.0001 ** (-i)).sqrt().times(2**96)).toFixed(0));
    //           expect(res2[0]).to.equal((-i)-1);
    //           //expect(res2[0] + 1).to.equal(res2[1]);
    //     }
    // });
});