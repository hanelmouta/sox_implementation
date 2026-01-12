use anyhow::{bail, Context, Result};
use crypto_lib::hpre_v2;
use hex::encode;
use serde::Serialize;
use std::fs;

#[derive(Serialize)]
struct HpreOutput {
    hpre_hex: String,
}

fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 3 {
        bail!("Usage: hpre_cli <evaluated_circuit_file> <num_blocks> <challenge>");
    }

    let evaluated_circuit_path = &args[0];
    let num_blocks: usize = args[1].parse().context("Invalid num_blocks")?;
    let challenge: usize = args[2].parse().context("Invalid challenge")?;

    // Read evaluated circuit file
    let evaluated_circuit_bytes = fs::read(evaluated_circuit_path)
        .with_context(|| format!("reading evaluated circuit from {:?}", evaluated_circuit_path))?;

    // Compute hpre using the native Rust function (same as WASM but called from Rust)
    let hpre_bytes = hpre_v2(&evaluated_circuit_bytes, num_blocks, challenge);
    
    let out = HpreOutput {
        hpre_hex: encode(&hpre_bytes),
    };

    let json = serde_json::to_string_pretty(&out)?;
    println!("{}", json);
    Ok(())
}



