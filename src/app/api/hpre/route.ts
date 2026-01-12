import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HPRE_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "hpre_cli"
);

export async function POST(req: Request) {
    try {
        const { evaluated_circuit_hex, num_blocks, challenge, contractId } = await req.json();

        if (!evaluated_circuit_hex || num_blocks === undefined || challenge === undefined) {
            return NextResponse.json(
                { error: "Les champs 'evaluated_circuit_hex', 'num_blocks' et 'challenge' sont requis" },
                { status: 400 }
            );
        }

        // Create temp directory if it doesn't exist
        const tempDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Write temporary file
        const tempEvaluatedCircuitPath = path.join(tempDir, `evaluated_${contractId || Date.now()}.bin`);
        const evaluated_circuit_bytes = Buffer.from(evaluated_circuit_hex, "hex");
        fs.writeFileSync(tempEvaluatedCircuitPath, evaluated_circuit_bytes);

        // Call CLI
        const { stdout } = await execFileAsync(HPRE_CLI_PATH, [
            tempEvaluatedCircuitPath,
            num_blocks.toString(),
            challenge.toString(),
        ]);

        // Clean up temp file
        fs.unlinkSync(tempEvaluatedCircuitPath);

        let parsed: any;
        try {
            parsed = JSON.parse(stdout.toString());
        } catch (e: any) {
            console.error("Erreur de parsing JSON depuis hpre_cli:", e, stdout.toString());
            return NextResponse.json(
                { error: "Erreur serveur: sortie invalide du binaire hpre" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            hpre_hex: parsed.hpre_hex,
        });
    } catch (error: any) {
        console.error("Erreur dans POST /api/hpre:", error);
        return NextResponse.json(
            { error: `Erreur serveur: ${error.message || error}` },
            { status: 500 }
        );
    }
}



