const {
    expect,
    use
} = require("chai");
const {
    ethers
} = require("hardhat");
const BigNumber = require('bignumber.js');


describe("Mul Div Math", function () {
    var signer, miner1, miner2, trader, seller, receiver;
    var contract;
    var q128;
    var q256;
    beforeEach(async function () {
        [signer, miner1, miner2, miner3, trader, seller, receiver] = await ethers.getSigners();

        const mulDivMathContractFactory = await ethers.getContractFactory("TestMulDivMath");
        contract = await mulDivMathContractFactory.deploy();

        q256 = BigNumber(2).pow(256);
        q128 = BigNumber(2).pow(128);

    });

    it("test gas cost", async function () {
        let a = new BigNumber(1231232323211).times(Math.floor(Math.random() * 10000)).times(q128).toFixed(0);
        let b = new BigNumber(12312323232112123132311).times(q128).toFixed(0);
        let c = new BigNumber(23232112123132311).times(q128).toFixed(0);
        const res = (await contract.getGasCostOfMulDivFloor(a, b, c)).toString();
        console.log('   gas cost: ', res);
    });

    it("test mul div floor", async function () {
        let a = new BigNumber(1231232323211).times(Math.floor(Math.random() * 10000)).times(q128);
        let b = new BigNumber(12312323232112123132311).times(q128);
        let c = new BigNumber(23232112123132311).times(q128);
        let d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 3));
        if (d.lt(2 ** 256)) {
            let res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            let e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(12312323231).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(23232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 3));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(12312323231).times(2 ** 49).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(23232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 3));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(912312323231).times(2 ** 49).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(8123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(7232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 3));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(12312323231).times(2 ** 49).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(23232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 3));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }
    });

    it("test mul div ceil", async function () {
        let a = new BigNumber(1231232323211).times(Math.floor(Math.random() * 10000)).times(q128);
        let b = new BigNumber(12312323232112123132311).times(q128);
        let c = new BigNumber(23232112123132311).times(q128);
        let d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 2));
        if (d.lt(2 ** 256)) {
            let res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            let e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(12312323231).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(23232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 2));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(12312323231).times(2 ** 49).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(23232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 2));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(912312323231).times(2 ** 49).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(8123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(7232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 2));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }

        a = new BigNumber(12312323231).times(2 ** 49).times(Math.floor(Math.random() * 10000)).times(q128);
        b = new BigNumber(123123232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        c = new BigNumber(23232112123132311).times(Math.floor(Math.random() * 10000)).times(q128);
        d = a.times(b).div(c);
        console.log(d.toFixed(8));
        console.log(d.toFixed(0, 2));
        if (d.lt(2 ** 256)) {
            res = (await contract.getMulDivFloor(a.toFixed(0), b.toFixed(0), c.toFixed(0))).toString();
            e = new BigNumber(res).toFixed(0);
            console.log(e);
            expect(e).to.equal(d.toFixed(0, 3))
        }
    });
});