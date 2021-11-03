/**
 * Copyright 2020 ChainSafe Systems
 * SPDX-License-Identifier: LGPL-3.0-only
 * truffle test ./test/contractBridge/depositNative.js
 */

const TruffleAssert = require('truffle-assertions');
const Ethers = require('ethers');
const Helpers = require('../helpers');

const BridgeContract = artifacts.require("Bridge");
const ERC20MintableContract = artifacts.require("ERC20PresetMinterPauser");
const NativeHandlerContract = artifacts.require("NativeHandler");
// const ERC20HandlerContract = artifacts.require("ERC20Handler");

contract('Bridge - [deposit - Native coin]', async (accounts) => {
    const originDomainID = 1;
    const destinationDomainID = 2;
    const depositerAddress = accounts[1];
    const recipientAddress = accounts[2];
    // const originChainInitialTokenAmount = 100;
    const depositAmount = 10;
    const expectedDepositNonce = 1;
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const relayer1Address = accounts[0];
    const relayer2Address = accounts[1];
    const relayer1Bit = 1 << 0;
    const relayer2Bit = 1 << 1;
    const relayerThreshold = 2;
    const expectedFinalizedEventStatus = 2;
    const expectedExecutedEventStatus = 3;

    let BridgeInstance;
    let BridgeInstance2;
    let OriginNativeHandlerInstance;
    let DestinationERC20HandlerInstance;
    let DestinationERC20MintableInstance;
    let burnableContractAddresses;
    let depositData;
    let depositDataHash = '';
    let withdrawData;
    let withdrawDataHash = '';

    let vote, executeProposal;

    beforeEach(async () => {
        await Promise.all([
            BridgeInstance = await BridgeContract.new(originDomainID, [relayer1Address, relayer2Address], relayerThreshold, 0, 100),
            BridgeInstance2 = await BridgeContract.new(originDomainID, [relayer1Address, relayer2Address], relayerThreshold, 0, 100),
            ERC20MintableContract.new("token", "TOK").then(instance => DestinationERC20MintableInstance = instance)
        ]);


        resourceID = Helpers.createResourceID(zeroAddress, originDomainID);
        initialResourceIDs = [];
        initialContractAddresses = [];
        burnableContractAddresses = [];

        burnableContractAddress = DestinationERC20MintableInstance.address;

        OriginNativeHandlerInstance = await NativeHandlerContract.new(BridgeInstance.address, initialResourceIDs, initialContractAddresses, burnableContractAddresses);
        DestinationNativeHandlerInstance = await NativeHandlerContract.new(BridgeInstance2.address, initialResourceIDs, initialContractAddresses, burnableContractAddresses);

        await Promise.all([
            BridgeInstance.adminSetResource(OriginNativeHandlerInstance.address, resourceID, zeroAddress),
            BridgeInstance2.adminSetResource(DestinationNativeHandlerInstance.address, resourceID, burnableContractAddress),
            BridgeInstance2.adminSetBurnable(DestinationNativeHandlerInstance.address, burnableContractAddress),
            DestinationERC20MintableInstance.grantRole(await DestinationERC20MintableInstance.MINTER_ROLE(), DestinationNativeHandlerInstance.address),
            DestinationERC20MintableInstance.approve(DestinationNativeHandlerInstance.address, depositAmount, { from: recipientAddress })
        ]);

        depositData = Helpers.createERCDepositData(
            depositAmount,
            20,
            recipientAddress);
        depositDataHash = Ethers.utils.keccak256(DestinationNativeHandlerInstance.address + depositData.substr(2));

        withdrawData = Helpers.createERCDepositData(
            depositAmount,
            20,
            depositerAddress);
        withdrawDataHash = Ethers.utils.keccak256(OriginNativeHandlerInstance.address + withdrawData.substr(2));

        vote = (relayer) => BridgeInstance2.voteProposal(originDomainID, expectedDepositNonce, resourceID, depositData, { from: relayer });
        executeProposal = (relayer) => BridgeInstance2.executeProposal(originDomainID, expectedDepositNonce, depositData, resourceID, { from: relayer });
    });

    it("[sanity] test depositerAddress' balance", async () => {
        let originChainDepositerBalance = await web3.eth.getBalance(depositerAddress);
        console.log("depositerAddress balance:", originChainDepositerBalance)
        // assert.strictEqual(originChainDepositerBalance.toNumber(), originChainInitialTokenAmount);
    });

    it('Native coin deposit can be made', async () => {
        await TruffleAssert.passes(BridgeInstance.deposit(
            destinationDomainID,
            resourceID,
            depositData,
            { from: depositerAddress, value: depositAmount }
        ));
    });

    it('_depositCounts should be increments from 0 to 1', async () => {
        await BridgeInstance.deposit(
            destinationDomainID,
            resourceID,
            depositData,
            { from: depositerAddress, value: depositAmount }
        );

        const depositCount = await BridgeInstance._depositCounts.call(destinationDomainID);
        assert.strictEqual(depositCount.toNumber(), expectedDepositNonce);
    });

    it('Native coin can be deposited with correct balances', async () => {
        const originChainInitialTokenAmount = await web3.eth.getBalance(depositerAddress);
        await BridgeInstance.deposit(
            destinationDomainID,
            resourceID,
            depositData,
            { from: depositerAddress, value: depositAmount }
        );

        const originChainDepositerBalance = await web3.eth.getBalance(depositerAddress);
        console.log("originChainDepositer balance:", originChainDepositerBalance)
        // assert.strictEqual(originChainDepositerBalance, originChainInitialTokenAmount - depositAmount);

        const originChainHandlerBalance = await web3.eth.getBalance(OriginNativeHandlerInstance.address);
        console.log("originChainHandler balance:", originChainHandlerBalance)
        assert.strictEqual(originChainHandlerBalance, depositAmount.toString());
    });

    it('Deposit event is fired with expected value', async () => {
        let depositTx = await BridgeInstance.deposit(
            destinationDomainID,
            resourceID,
            depositData,
            { from: depositerAddress, value: depositAmount }
        );

        TruffleAssert.eventEmitted(depositTx, 'Deposit', (event) => {
            return event.destinationChainID.toNumber() === destinationDomainID &&
                event.resourceID === resourceID.toLowerCase() &&
                event.depositNonce.toNumber() === expectedDepositNonce
        });

        depositTx = await BridgeInstance.deposit(
            destinationDomainID,
            resourceID,
            depositData,
            { from: depositerAddress, value: depositAmount }
        );

        TruffleAssert.eventEmitted(depositTx, 'Deposit', (event) => {
            return event.destinationChainID.toNumber() === destinationDomainID &&
                event.resourceID === resourceID.toLowerCase() &&
                event.depositNonce.toNumber() === expectedDepositNonce + 1
        });
    });

    it('deposit requires resourceID that is mapped to a handler', async () => {
        await TruffleAssert.reverts(BridgeInstance.deposit(destinationDomainID, '0x0', depositData, { from: depositerAddress }), "resourceID not mapped to handler");
    });

    it('Destination Chain Execution successful', async () => {
        await TruffleAssert.passes(vote(relayer1Address));
        const voteWithExecuteTx = await vote(relayer2Address); // After this vote, automatically executes the proposal.
        TruffleAssert.eventEmitted(voteWithExecuteTx, 'ProposalEvent', (event) => {
            return event.originChainID.toNumber() === originDomainID &&
                event.depositNonce.toNumber() === expectedDepositNonce &&
                event.status.toNumber() === expectedFinalizedEventStatus &&
                event.dataHash === depositDataHash
        });

        const destChainRecipientBalance = await DestinationERC20MintableInstance.balanceOf(recipientAddress);
        console.log("destChainRecipient balance:", destChainRecipientBalance.toNumber())
        assert.strictEqual(destChainRecipientBalance.toNumber(), depositAmount);

        const totalSupply = await DestinationERC20MintableInstance.totalSupply();
        console.log("totalSupply:", totalSupply.toNumber())
        assert.strictEqual(totalSupply.toNumber(), depositAmount);

        await TruffleAssert.passes(BridgeInstance2.deposit(
            originDomainID,
            resourceID,
            withdrawData,
            { from: recipientAddress }
        ));

        const recipientBalance = await DestinationERC20MintableInstance.balanceOf(recipientAddress);
        console.log("destChainRecipient balance2:", recipientBalance.toNumber())
        assert.strictEqual(recipientBalance.toNumber(), 0);
    });

    it('Original Chain Execution successful', async () => {

        const withdrawVote = (relayer) => BridgeInstance.voteProposal(originDomainID, expectedDepositNonce, resourceID, withdrawData, { from: relayer });

        await BridgeInstance.deposit(
            destinationDomainID,
            resourceID,
            depositData,
            { from: depositerAddress, value: depositAmount }
        );

        var originChainHandlerBalance = await web3.eth.getBalance(OriginNativeHandlerInstance.address);
        assert.strictEqual(originChainHandlerBalance, depositAmount.toString());

        var originChainDepositerBalance = await web3.eth.getBalance(depositerAddress);
        console.log("originChainDepositer balance 1:", originChainDepositerBalance)

        await TruffleAssert.passes(withdrawVote(relayer1Address));
        const voteWithExecuteTx = await withdrawVote(relayer2Address); // After this vote, automatically executes the proposal.
        TruffleAssert.eventEmitted(voteWithExecuteTx, 'ProposalEvent', (event) => {
            return event.originChainID.toNumber() === originDomainID &&
                event.depositNonce.toNumber() === expectedDepositNonce &&
                event.status.toNumber() === expectedFinalizedEventStatus &&
                event.dataHash === withdrawDataHash
        });

        originChainHandlerBalance = await web3.eth.getBalance(OriginNativeHandlerInstance.address);
        assert.strictEqual(originChainHandlerBalance, '0');

        originChainDepositerBalance = await web3.eth.getBalance(depositerAddress);
        console.log("originChainDepositer balance 2:", originChainDepositerBalance)

    });
});