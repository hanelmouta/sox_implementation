use anyhow::{bail, Context, Result};
use crypto_lib::{compute_proof_right, compute_proofs_left, compute_proofs};
use hex::encode;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize)]
struct ProofsV2Output {
    gate_bytes: Vec<u8>,        // 64 bytes
    values: Vec<Vec<u8>>,      // Array of byte arrays
    curr_acc: Vec<u8>,         // 32 bytes
    proof1: Vec<Vec<Vec<u8>>>, // bytes32[][]
    proof2: Vec<Vec<Vec<u8>>>, // bytes32[][]
    proof3: Vec<Vec<Vec<u8>>>, // bytes32[][]
    proof_ext: Vec<Vec<Vec<u8>>>, // bytes32[][]
}

#[derive(Serialize, Deserialize)]
struct ProofRightOutput {
    proof: Vec<Vec<String>>, // Each layer is Vec<String> (hex-encoded bytes32)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    
    if args.len() < 5 {
        bail!("Usage: compute_proofs_cli <state> <evaluated_circuit_file> <num_blocks> <num_gates> <circuit_file> <ct_file> <challenge>");
    }

    let state: u32 = args[0].parse().context("Invalid state")?;
    let evaluated_circuit_path = &args[1];
    let num_blocks: u32 = args[2].parse().context("Invalid num_blocks")?;
    let num_gates: u32 = args[3].parse().context("Invalid num_gates")?;

    let evaluated_circuit_bytes = fs::read(evaluated_circuit_path)
        .with_context(|| format!("reading evaluated circuit from {:?}", evaluated_circuit_path))?;

    match state {
        2 => {
            // State 2: WaitVendorData - compute_proofs_v2
            if args.len() < 7 {
                bail!("State 2 requires: <state> <evaluated_circuit_file> <num_blocks> <num_gates> <circuit_file> <ct_file> <challenge>");
            }
            
            let circuit_path = &args[4];
            let ct_path = &args[5];
            let challenge: u32 = args[6].parse().context("Invalid challenge")?;
            
            let circuit_bytes = fs::read(circuit_path)
                .with_context(|| format!("reading circuit from {:?}", circuit_path))?;
            let ct_bytes = fs::read(ct_path)
                .with_context(|| format!("reading ciphertext from {:?}", ct_path))?;
            
            // Call native Rust function
            let (gate_bytes, values, curr_acc, proof1, proof2, proof3, proof_ext) = 
                compute_proofs(&circuit_bytes, &evaluated_circuit_bytes, &ct_bytes, challenge);
            
            let output = ProofsV2Output {
                gate_bytes,
                values,
                curr_acc,
                proof1,
                proof2,
                proof3,
                proof_ext,
            };
            
            let json = serde_json::to_string_pretty(&output)?;
            println!("{}", json);
        }
        3 => {
            // State 3: WaitVendorDataLeft - compute_proofs_left_v2
            if args.len() < 7 {
                bail!("State 3 requires: <state> <evaluated_circuit_file> <num_blocks> <num_gates> <circuit_file> <ct_file> <challenge>");
            }
            
            let circuit_path = &args[4];
            let ct_path = &args[5];
            let challenge: u32 = args[6].parse().context("Invalid challenge")?;
            
            let circuit_bytes = fs::read(circuit_path)
                .with_context(|| format!("reading circuit from {:?}", circuit_path))?;
            let ct_bytes = fs::read(ct_path)
                .with_context(|| format!("reading ciphertext from {:?}", ct_path))?;
            
            // Call native Rust function
            let (gate_bytes, values, curr_acc, proof1, proof2, proof_ext) = 
                compute_proofs_left(&circuit_bytes, &evaluated_circuit_bytes, &ct_bytes, challenge);
            
            let output = ProofsV2Output {
                gate_bytes,
                values,
                curr_acc,
                proof1,
                proof2,
                proof3: Vec::new(), // Empty for left case
                proof_ext,
            };
            
            let json = serde_json::to_string_pretty(&output)?;
            println!("{}", json);
        }
        4 => {
            // State 4: WaitVendorDataRight - compute_proof_right
            let proof = compute_proof_right(&evaluated_circuit_bytes, num_blocks, num_gates);
            
            // Convert proof to hex strings (bytes32 format)
            let proof_hex: Vec<Vec<String>> = proof
                .iter()
                .map(|layer| {
                    layer
                        .iter()
                        .map(|item| {
                            // Ensure each item is exactly 32 bytes (bytes32)
                            if item.len() != 32 {
                                panic!("Proof item length is {} bytes, expected 32", item.len());
                            }
                            encode(item)
                        })
                        .collect()
                })
                .collect();

            let output = ProofRightOutput { proof: proof_hex };
            let json = serde_json::to_string_pretty(&output)?;
            println!("{}", json);
        }
        _ => {
            bail!("State {} not supported. Supported states: 2 (WaitVendorData), 3 (WaitVendorDataLeft), 4 (WaitVendorDataRight)", state);
        }
    }

    Ok(())
}
