import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EVALUATE_CIRCUIT_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "evaluate_circuit_cli"
);

export async function POST(req: Request) {
    try {
        const { circuit_hex, ct_hex, key_hex, contractId } = await req.json();

        if (!circuit_hex || !ct_hex || !key_hex) {
            return NextResponse.json(
                { error: "Les champs 'circuit_hex', 'ct_hex' et 'key_hex' sont requis" },
                { status: 400 }
            );
        }

        // Create temp directory if it doesn't exist
        const tempDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Write temporary files
        const tempCircuitPath = path.join(tempDir, `circuit_${contractId || Date.now()}.bin`);
        const tempCtPath = path.join(tempDir, `ct_${contractId || Date.now()}.bin`);
        const tempOutputPath = path.join(tempDir, `evaluated_${contractId || Date.now()}.bin`);

        const circuit_bytes = Buffer.from(circuit_hex, "hex");
        const ct_bytes = Buffer.from(ct_hex, "hex");

        fs.writeFileSync(tempCircuitPath, circuit_bytes);
        fs.writeFileSync(tempCtPath, ct_bytes);

        // Remove 0x prefix from key_hex if present
        const cleanKeyHex = key_hex.startsWith("0x") ? key_hex.slice(2) : key_hex;

        // Call CLI
        const { stdout } = await execFileAsync(EVALUATE_CIRCUIT_CLI_PATH, [
            tempCircuitPath,
            tempCtPath,
            cleanKeyHex,
            tempOutputPath,
        ]);

        // Read evaluated circuit from output file
        const evaluated_circuit_bytes = fs.readFileSync(tempOutputPath);
        const evaluated_circuit_hex = evaluated_circuit_bytes.toString("hex");

        // Clean up temp files
        fs.unlinkSync(tempCircuitPath);
        fs.unlinkSync(tempCtPath);
        fs.unlinkSync(tempOutputPath);

        return NextResponse.json({
            evaluated_circuit_hex,
        });
    } catch (error: any) {
        console.error("Erreur dans POST /api/circuit/evaluate:", error);
        return NextResponse.json(
            { error: `Erreur serveur: ${error.message || error}` },
            { status: 500 }
        );
    }
}



