use anyhow::{bail, Context, Result};
use crypto_lib::evaluate_circuit;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
struct EvaluateCircuitOutput {
    evaluated_circuit_path: String,
}

fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 3 {
        bail!("Usage: evaluate_circuit_cli <circuit_file> <ciphertext_file> <key_hex> [output_file]");
    }

    let circuit_path = PathBuf::from(&args[0]);
    let ct_path = PathBuf::from(&args[1]);
    let key_hex = &args[2];
    
    let output_path = if let Some(path) = args.get(3) {
        PathBuf::from(path)
    } else {
        circuit_path.with_extension("evaluated")
    };

    // Read circuit and ciphertext files
    let circuit_bytes = fs::read(&circuit_path)
        .with_context(|| format!("reading circuit from {:?}", circuit_path))?;
    let ct_bytes = fs::read(&ct_path)
        .with_context(|| format!("reading ciphertext from {:?}", ct_path))?;

    // Evaluate circuit using the native Rust function
    // The key_hex can have "0x" prefix or not - hex_to_bytes handles both
    let evaluated_bytes = evaluate_circuit(
        &circuit_bytes,
        &ct_bytes,
        key_hex,
    );
    
    // Write evaluated circuit to file
    fs::write(&output_path, &evaluated_bytes)
        .with_context(|| format!("writing evaluated circuit to {:?}", output_path))?;

    let out = EvaluateCircuitOutput {
        evaluated_circuit_path: output_path.to_string_lossy().into_owned(),
    };

    let json = serde_json::to_string_pretty(&out)?;
    println!("{}", json);
    Ok(())
}

