import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "ethers";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "path";
import { performance } from "perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";
import {
    initSync,
    EvaluatedCircuitV2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    bytes_to_hex,
} from "../../../app/lib/crypto_lib/crypto_lib";

const execFileAsync = promisify(execFile);

/**
 * Complete Dispute Phase Gas Cost Test - 1GB File (Honest Vendor)
 * 
 * This test:
 * 1. Generates a 1GB file
 * 2. Encrypts the file and computes precontract
 * 3. Deploys all contracts
 * 4. Completes optimistic phase
 * 5. Executes complete dispute phase (honest vendor scenario)
 * 6. Measures total gas cost for dispute phase
 * 
 * All responses and opinions are computed automatically (like the platform)
 */

describe("Complete Dispute Phase Gas Cost - 1GB File (Honest Vendor)", function () {
    let entryPoint: any;
    let vendor: HardhatEthersSigner;
    let buyer: HardhatEthersSigner;
    let sponsor: HardhatEthersSigner;
    let buyerDisputeSponsor: HardhatEthersSigner;
    let vendorDisputeSponsor: HardhatEthersSigner;
    
    let optimisticAccount: any;
    let disputeAccount: any;
    let disputeDeployer: any;
    
    let commitment: { c: string; o: string };
    let key: Uint8Array;
    let itemDescription: Uint8Array;
    let ct: Uint8Array;
    let circuit: Uint8Array;
    let evaluatedCircuit: any;
    let numBlocks: number;
    let numGates: number;
    
    const FILE_SIZE_GB = 1;
    const FILE_SIZE_BYTES = FILE_SIZE_GB * 1024 * 1024 * 1024; // 1 GB
    
    const AGREED_PRICE = parseEther("1.0");
    const COMPLETION_TIP = parseEther("0.1");
    const DISPUTE_TIP = parseEther("0.2");
    const TIMEOUT_INCREMENT = 3600n;
    const SPONSOR_FEES = 5n;
    const DISPUTE_FEES = 10n;
    
    // Gas measurement tracking
    const gasCosts = {
        disputePhaseTotal: 0n,
        respondChallenge: 0n,
        giveOpinion: 0n,
        submitCommitment: 0n,
        submitCommitmentLeft: 0n,
        completeDispute: 0n,
        transactions: [] as Array<{ name: string; gas: bigint }>,
    };
    
    before(async function () {
        this.timeout(3600000); // 60 minutes for setup (1GB takes time)
        
        [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] = await ethers.getSigners();
        
        console.log("\n" + "=".repeat(80));
        console.log("📋 COMPLETE DISPUTE PHASE GAS COST TEST - 1GB FILE");
        console.log("=".repeat(80));
        
        // Step 1: Generate 1GB test file
        console.log("\n1️⃣ Generating 1GB test file...");
        const testFilePath = join(__dirname, "../../../test_1gb.bin");
        try {
            await readFile(testFilePath);
            console.log(`✅ Test file already exists: ${testFilePath}`);
        } catch {
            console.log("   Creating 1GB file (this may take a moment)...");
            const fileBuffer = Buffer.alloc(FILE_SIZE_BYTES, 0x42); // Fill with pattern
            await writeFile(testFilePath, fileBuffer);
            console.log(`✅ 1GB test file created: ${testFilePath}`);
        }
        
        // Step 2: Initialize WASM
        console.log("\n2️⃣ Initializing WASM...");
        const wasmPath = join(__dirname, "../../../app/lib/crypto_lib/crypto_lib_bg.wasm");
        const wasmBytes = await readFile(wasmPath);
        initSync({ module: wasmBytes });
        console.log("✅ WASM initialized");
        
        // Step 3: Generate AES key and compute precontract using native Rust CLI
        console.log("\n3️⃣ Computing precontract using native Rust CLI...");
        
        // Generate AES key
        key = new Uint8Array([
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10
        ]);
        const keyHexWithPrefix = bytes_to_hex(key);
        // Remove "0x" prefix for Rust CLI (it expects hex without prefix)
        const keyHex = keyHexWithPrefix.startsWith("0x") ? keyHexWithPrefix.slice(2) : keyHexWithPrefix;
        console.log(`✅ AES key generated: 0x${keyHex}`);
        
        // Compute precontract using native Rust CLI (for 1GB file, WASM is too limited)
        console.log("   Computing precontract using native Rust CLI (this may take a few minutes for 1GB)...");
        const precontractStart = performance.now();
        
        // Path to precontract_cli (relative to project root)
        // __dirname is in src/hardhat/test/performance/, so we go up 4 levels to project root
        const projectRoot = join(__dirname, "../../../..");
        const PRECONTRACT_CLI_PATH = join(
            projectRoot,
            "src",
            "wasm",
            "target",
            "release",
            "precontract_cli"
        );
        
        // Run precontract_cli with key (without 0x prefix)
        const { stdout } = await execFileAsync(PRECONTRACT_CLI_PATH, [testFilePath, keyHex]);
        const preOut = JSON.parse(stdout.toString());
        const precontractTime = performance.now() - precontractStart;
        
        console.log(`✅ Precontract computed in ${(precontractTime / 1000).toFixed(2)}s`);
        console.log(`   numBlocks: ${preOut.num_blocks.toLocaleString()}`);
        console.log(`   numGates: ${preOut.num_gates.toLocaleString()}`);
        
        // Load ciphertext and circuit from files generated by CLI
        const ctPath = preOut.ciphertext_path || testFilePath.replace(/\.bin$/, ".ct");
        const circuitPath = preOut.circuit_path || testFilePath.replace(/\.bin$/, ".circuit");
        
        console.log(`   Loading ciphertext from: ${ctPath}`);
        console.log(`   Loading circuit from: ${circuitPath}`);
        
        const ctBytes = await readFile(ctPath);
        const circuitBytes = await readFile(circuitPath);
        
        ct = new Uint8Array(ctBytes);
        circuit = new Uint8Array(circuitBytes);
        numBlocks = preOut.num_blocks;
        numGates = preOut.num_gates;
        
        // Convert commitment from hex strings to Uint8Array
        const commitmentCHex = preOut.commitment_c_hex.startsWith("0x") 
            ? preOut.commitment_c_hex.slice(2) 
            : preOut.commitment_c_hex;
        const commitmentOHex = preOut.commitment_o_hex.startsWith("0x")
            ? preOut.commitment_o_hex.slice(2)
            : preOut.commitment_o_hex;
        
        commitment = {
            c: new Uint8Array(Buffer.from(commitmentCHex, "hex")),
            o: new Uint8Array(Buffer.from(commitmentOHex, "hex")),
        };
        
        // Load item description (original file) for later use
        const fileBytes = await readFile(testFilePath);
        itemDescription = new Uint8Array(fileBytes);
        console.log(`✅ File loaded: ${itemDescription.length} bytes (${(itemDescription.length / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        
        
        // Evaluate circuit using native Rust CLI (for 1GB file, WASM is too limited)
        console.log("\n4️⃣ Evaluating circuit using native Rust CLI (this may take a few minutes for 1GB)...");
        const evaluateStart = performance.now();
        
        const EVALUATE_CIRCUIT_CLI_PATH = join(
            projectRoot,
            "src",
            "wasm",
            "target",
            "release",
            "evaluate_circuit_cli"
        );
        
        const evaluatedCircuitPath = circuitPath.replace(/\.circuit$/, ".evaluated");
        
        // Run evaluate_circuit_cli
        const { stdout: evalStdout } = await execFileAsync(EVALUATE_CIRCUIT_CLI_PATH, [
            circuitPath,
            ctPath,
            keyHex
        ]);
        const evalOut = JSON.parse(evalStdout.toString());
        const evaluateTime = performance.now() - evaluateStart;
        
        // Load evaluated circuit from file
        const evaluatedCircuitBytes = await readFile(evalOut.evaluated_circuit_path);
        evaluatedCircuit = EvaluatedCircuitV2.from_bytes(new Uint8Array(evaluatedCircuitBytes));
        
        console.log(`✅ Circuit evaluated in ${(evaluateTime / 1000).toFixed(2)}s`);
        
        // Step 4: Deploy EntryPoint
        console.log("\n5️⃣ Deploying EntryPoint...");
        const EntryPointFactory = new ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            sponsor
        );
        entryPoint = await EntryPointFactory.deploy();
        await entryPoint.waitForDeployment();
        console.log(`✅ EntryPoint deployed: ${await entryPoint.getAddress()}`);
        
        // Step 5: Deploy libraries and DisputeDeployer
        console.log("\n6️⃣ Deploying libraries and DisputeDeployer...");
        const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();
        
        const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
        const commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();
        
        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();
        
        const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        });
        disputeDeployer = await DisputeDeployerFactory.deploy();
        await disputeDeployer.waitForDeployment();
        console.log(`✅ DisputeDeployer deployed: ${await disputeDeployer.getAddress()}`);
        
        // Step 6: Deploy OptimisticSOXAccount
        console.log("\n7️⃣ Deploying OptimisticSOXAccount...");
        const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });
        optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            AGREED_PRICE,
            COMPLETION_TIP,
            DISPUTE_TIP,
            TIMEOUT_INCREMENT,
            commitment.c,
            numBlocks,
            numGates,
            await vendor.getAddress(),
            { value: SPONSOR_FEES }
        );
        await optimisticAccount.waitForDeployment();
        console.log(`✅ OptimisticSOXAccount deployed: ${await optimisticAccount.getAddress()}`);
        
        // Step 7: Complete optimistic phase
        console.log("\n8️⃣ Completing optimistic phase...");
        const tx1 = await optimisticAccount.connect(buyer).sendPayment({ 
            value: AGREED_PRICE + COMPLETION_TIP 
        });
        await tx1.wait();
        console.log("✅ Buyer sent payment");
        
        const tx2 = await optimisticAccount.connect(vendor).sendKey(key);
        await tx2.wait();
        console.log("✅ Vendor sent key");
        
        const tx3 = await optimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
            value: DISPUTE_FEES + DISPUTE_TIP
        });
        await tx3.wait();
        console.log("✅ Buyer dispute sponsor sent fee");
        
        const tx4 = await optimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
            value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE
        });
        await tx4.wait();
        console.log("✅ Vendor dispute sponsor sent fee (DisputeSOXAccount deployed)");
        
        // Step 8: Get DisputeSOXAccount
        console.log("\n9️⃣ Getting DisputeSOXAccount...");
        const disputeAddress = await optimisticAccount.disputeContract();
        disputeAccount = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
        console.log(`✅ DisputeSOXAccount: ${disputeAddress}`);
        
        console.log("\n✅ Setup complete! Ready for dispute phase.\n");
    });
    
    it("Should execute complete dispute phase with honest vendor and measure gas costs", async function () {
        this.timeout(3600000); // 60 minutes for dispute (1GB takes time)
        
        console.log("\n" + "=".repeat(80));
        console.log("🚀 STARTING DISPUTE PHASE (Honest Vendor Scenario)");
        console.log("=".repeat(80));
        
        let state = Number(await disputeAccount.currState());
        let a = Number(await disputeAccount.a());
        let b = Number(await disputeAccount.b());
        let chall = Number(await disputeAccount.chall());
        
        console.log(`\n📊 Initial state: ${state}`);
        console.log(`   a=${a}, b=${b}, chall=${chall}`);
        
        const disputeStart = performance.now();
        let phaseCount = 0;
        const maxPhases = 100; // Safety limit
        
        // Execute dispute phase - automatic responses like the platform
        while ((state === 0 || state === 1 || state === 2 || state === 3 || state === 4) && phaseCount < maxPhases) {
            phaseCount++;
            console.log(`\n📍 Phase ${phaseCount}: State=${state}, a=${a}, b=${b}, chall=${chall}`);
            
            if (state === 0) {
                // ChallengeBuyer - buyer responds with CORRECT hpre (computed automatically using native CLI)
                console.log(`   🔍 Computing hpre for gate ${chall} using native CLI...`);
                const hpreStart = performance.now();
                
                const HPRE_CLI_PATH = join(
                    projectRoot,
                    "src",
                    "wasm",
                    "target",
                    "release",
                    "hpre_cli"
                );
                
                const evaluatedCircuitPath = circuitPath.replace(/\.circuit$/, ".evaluated");
                const { stdout: hpreStdout } = await execFileAsync(HPRE_CLI_PATH, [
                    evaluatedCircuitPath,
                    numBlocks.toString(),
                    chall.toString()
                ]);
                const hpreOut = JSON.parse(hpreStdout.toString());
                const correctHpreHex = hpreOut.hpre_hex;
                const hpreTime = performance.now() - hpreStart;
                
                console.log(`   ✅ hpre computed in ${(hpreTime / 1000).toFixed(2)}s`);
                console.log(`   👤 Buyer responds with correct hpre: ${correctHpreHex.slice(0, 20)}...`);
                
                const tx = await disputeAccount.connect(buyer).respondChallenge(correctHpreHex);
                const receipt = await tx.wait();
                const gasUsed = receipt?.gasUsed || 0n;
                gasCosts.respondChallenge += gasUsed;
                gasCosts.disputePhaseTotal += gasUsed;
                gasCosts.transactions.push({ name: `respondChallenge_${phaseCount}`, gas: gasUsed });
                console.log(`   ✅ Buyer responded (${gasUsed.toLocaleString()} gas)`);
                
            } else if (state === 1) {
                // WaitVendorOpinion - vendor computes opinion automatically (like platform) using native CLI
                const buyerResponse = await disputeAccount.buyerResponses(chall);
                const buyerResponseHex = ethers.hexlify(buyerResponse);
                
                console.log(`   🔍 Computing correct hpre to compare with buyer response using native CLI...`);
                const hpreStart = performance.now();
                
                const HPRE_CLI_PATH = join(
                    projectRoot,
                    "src",
                    "wasm",
                    "target",
                    "release",
                    "hpre_cli"
                );
                
                const evaluatedCircuitPath = circuitPath.replace(/\.circuit$/, ".evaluated");
                const { stdout: hpreStdout } = await execFileAsync(HPRE_CLI_PATH, [
                    evaluatedCircuitPath,
                    numBlocks.toString(),
                    chall.toString()
                ]);
                const hpreOut = JSON.parse(hpreStdout.toString());
                const correctHpreHex = hpreOut.hpre_hex;
                const hpreTime = performance.now() - hpreStart;
                
                const vendorAgrees = correctHpreHex.toLowerCase() === buyerResponseHex.toLowerCase();
                console.log(`   ✅ hpre computed in ${(hpreTime / 1000).toFixed(2)}s`);
                console.log(`   💭 Vendor opinion: ${vendorAgrees ? "AGREE" : "DISAGREE"}`);
                console.log(`      Correct: ${correctHpreHex.slice(0, 20)}...`);
                console.log(`      Buyer:   ${buyerResponseHex.slice(0, 20)}...`);
                
                const tx = await disputeAccount.connect(vendor).giveOpinion(vendorAgrees);
                const receipt = await tx.wait();
                const gasUsed = receipt?.gasUsed || 0n;
                gasCosts.giveOpinion += gasUsed;
                gasCosts.disputePhaseTotal += gasUsed;
                gasCosts.transactions.push({ name: `giveOpinion_${phaseCount}`, gas: gasUsed });
                console.log(`   ✅ Vendor ${vendorAgrees ? "agreed" : "disagreed"} (${gasUsed.toLocaleString()} gas)`);
                
            } else if (state === 2 || state === 3) {
                // WaitVendorDataLeft - vendor submits proofs
                console.log(`   📤 Vendor computes and submits proofs for gate ${chall} (left)...`);
                
                const proofsStart = performance.now();
                const proofs = compute_proofs_left_v2(
                    circuit,
                    evaluatedCircuit.to_bytes(),
                    ct,
                    chall
                );
                const proofsTime = performance.now() - proofsStart;
                console.log(`   ✅ Proofs computed in ${(proofsTime / 1000).toFixed(2)}s`);
                
                const gateBytesArray = new Uint8Array(proofs.gate_bytes);
                const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
                const currAccArray = new Uint8Array(proofs.curr_acc);
                const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                
                const tx = await disputeAccount.connect(vendor).submitCommitmentLeft(
                    ethers.hexlify(new Uint8Array(commitment.o)),
                    chall,
                    gateBytesArray,
                    valuesArray,
                    currAccArray,
                    proof1Array,
                    proof2Array,
                    proofExtArray
                );
                const receipt = await tx.wait();
                const gasUsed = receipt?.gasUsed || 0n;
                gasCosts.submitCommitmentLeft += gasUsed;
                gasCosts.disputePhaseTotal += gasUsed;
                gasCosts.transactions.push({ name: `submitCommitmentLeft_${phaseCount}`, gas: gasUsed });
                console.log(`   ✅ Vendor submitted proofs (${gasUsed.toLocaleString()} gas)`);
                
            } else if (state === 4) {
                // WaitVendorDataRight - vendor submits proofs
                console.log(`   📤 Vendor computes and submits proofs for gate ${chall} (right)...`);
                
                const proofsStart = performance.now();
                const proof = compute_proofs_v2(
                    circuit,
                    evaluatedCircuit.to_bytes(),
                    ct,
                    chall
                );
                const proofsTime = performance.now() - proofsStart;
                console.log(`   ✅ Proofs computed in ${(proofsTime / 1000).toFixed(2)}s`);
                
                const gateBytesArray = new Uint8Array(proof.gate_bytes);
                const valuesArray = proof.values.map((v: Uint8Array) => new Uint8Array(v));
                const currAccArray = new Uint8Array(proof.curr_acc);
                const proof1Array = proof.proof1.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof2Array = proof.proof2.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof3Array = proof.proof3.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proofExtArray = proof.proof_ext.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                
                const tx = await disputeAccount.connect(vendor).submitCommitment(
                    ethers.hexlify(new Uint8Array(commitment.o)),
                    chall,
                    gateBytesArray,
                    valuesArray,
                    currAccArray,
                    proof1Array,
                    proof2Array,
                    proof3Array,
                    proofExtArray
                );
                const receipt = await tx.wait();
                const gasUsed = receipt?.gasUsed || 0n;
                gasCosts.submitCommitment += gasUsed;
                gasCosts.disputePhaseTotal += gasUsed;
                gasCosts.transactions.push({ name: `submitCommitment_${phaseCount}`, gas: gasUsed });
                console.log(`   ✅ Vendor submitted proofs (${gasUsed.toLocaleString()} gas)`);
            }
            
            // Update state
            state = Number(await disputeAccount.currState());
            a = Number(await disputeAccount.a());
            b = Number(await disputeAccount.b());
            chall = Number(await disputeAccount.chall());
            
            // Check if dispute is complete
            if (state === 5) { // Complete
                console.log(`\n✅ Dispute completed (state 5 = Complete)`);
                break;
            } else if (state === 6) { // Cancel
                console.log(`\n❌ Dispute cancelled (state 6 = Cancel)`);
                break;
            }
        }
        
        // Complete the dispute
        if (state === 5) {
            console.log(`\n🏁 Completing dispute...`);
            const tx = await disputeAccount.completeDispute();
            const receipt = await tx.wait();
            const gasUsed = receipt?.gasUsed || 0n;
            gasCosts.completeDispute += gasUsed;
            gasCosts.disputePhaseTotal += gasUsed;
            gasCosts.transactions.push({ name: "completeDispute", gas: gasUsed });
            console.log(`✅ Dispute completed (${gasUsed.toLocaleString()} gas)`);
        }
        
        const disputeTime = performance.now() - disputeStart;
        
        // Print final gas cost report
        console.log("\n" + "=".repeat(80));
        console.log("📊 DISPUTE PHASE GAS COST REPORT");
        console.log("=".repeat(80));
        console.log(`\n📋 File Size: ${FILE_SIZE_GB} GB`);
        console.log(`📋 Number of Blocks: ${numBlocks.toLocaleString()}`);
        console.log(`📋 Number of Gates: ${numGates.toLocaleString()}`);
        console.log(`📋 Phases Executed: ${phaseCount}`);
        console.log(`⏱️  Total Time: ${(disputeTime / 1000).toFixed(2)}s`);
        console.log(`\n⛽ GAS COSTS:`);
        console.log(`   Total Dispute Phase: ${gasCosts.disputePhaseTotal.toLocaleString()} gas`);
        console.log(`   - respondChallenge: ${gasCosts.respondChallenge.toLocaleString()} gas`);
        console.log(`   - giveOpinion: ${gasCosts.giveOpinion.toLocaleString()} gas`);
        console.log(`   - submitCommitmentLeft: ${gasCosts.submitCommitmentLeft.toLocaleString()} gas`);
        console.log(`   - submitCommitment: ${gasCosts.submitCommitment.toLocaleString()} gas`);
        console.log(`   - completeDispute: ${gasCosts.completeDispute.toLocaleString()} gas`);
        
        console.log(`\n📊 Transaction Breakdown:`);
        gasCosts.transactions.forEach((tx, idx) => {
            console.log(`   ${idx + 1}. ${tx.name}: ${tx.gas.toLocaleString()} gas`);
        });
        
        // Calculate gas cost in ETH (assuming 20 gwei gas price)
        const gasPrice = 20n * 10n ** 9n; // 20 gwei
        const totalCostWei = gasCosts.disputePhaseTotal * gasPrice;
        const totalCostEth = Number(totalCostWei) / 1e18;
        
        console.log(`\n💰 ESTIMATED COST (at 20 gwei):`);
        console.log(`   ${totalCostEth.toFixed(6)} ETH`);
        console.log(`   ${(totalCostEth * 3000).toFixed(2)} USD (at $3000/ETH)`);
        
        console.log("\n" + "=".repeat(80));
        
        // Assertions
        expect(state).to.equal(5, "Dispute should complete successfully");
        expect(gasCosts.disputePhaseTotal).to.be.gt(0n, "Gas cost should be greater than 0");
    });
});

