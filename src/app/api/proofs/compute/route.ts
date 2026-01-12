import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UPLOADS_PATH } from "../../files/[id]/route";

const execFileAsync = promisify(execFile);

const COMPUTE_PROOFS_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "compute_proofs_cli"
);

export async function POST(req: Request) {
    try {
        const { state, contractId, num_blocks, num_gates, circuit_hex, ct_hex, evaluated_circuit_hex, challenge } = await req.json();

        if (!state || contractId === undefined || !num_blocks || !num_gates) {
            return NextResponse.json(
                { error: "Les champs 'state', 'contractId', 'num_blocks' et 'num_gates' sont requis" },
                { status: 400 }
            );
        }

        // Supported states: 2 (WaitVendorData), 3 (WaitVendorDataLeft), 4 (WaitVendorDataRight)
        if (![2, 3, 4].includes(state)) {
            return NextResponse.json(
                { error: `État ${state} non supporté. États supportés: 2 (WaitVendorData), 3 (WaitVendorDataLeft), 4 (WaitVendorDataRight)` },
                { status: 400 }
            );
        }

        // Create temp directory if it doesn't exist
        const tempDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // For states 2 and 3, we need circuit, ct, and challenge
        if (state === 2 || state === 3) {
            if (!circuit_hex || !ct_hex || !evaluated_circuit_hex || challenge === undefined) {
                return NextResponse.json(
                    { error: "Les champs 'circuit_hex', 'ct_hex', 'evaluated_circuit_hex' et 'challenge' sont requis pour les états 2 et 3" },
                    { status: 400 }
                );
            }

            // Write temporary files
            const tempCircuitPath = path.join(tempDir, `circuit_${contractId}.bin`);
            const tempCtPath = path.join(tempDir, `ct_${contractId}.bin`);
            const tempEvaluatedCircuitPath = path.join(tempDir, `evaluated_circuit_${contractId}.bin`);

            const circuit_bytes = Buffer.from(circuit_hex, "hex");
            const ct_bytes = Buffer.from(ct_hex, "hex");
            const evaluated_circuit_bytes = Buffer.from(evaluated_circuit_hex, "hex");

            fs.writeFileSync(tempCircuitPath, circuit_bytes);
            fs.writeFileSync(tempCtPath, ct_bytes);
            fs.writeFileSync(tempEvaluatedCircuitPath, evaluated_circuit_bytes);

            // Call CLI
            const { stdout } = await execFileAsync(COMPUTE_PROOFS_CLI_PATH, [
                state.toString(),
                tempEvaluatedCircuitPath,
                num_blocks.toString(),
                num_gates.toString(),
                tempCircuitPath,
                tempCtPath,
                challenge.toString(),
            ]);

            // Clean up temp files
            fs.unlinkSync(tempCircuitPath);
            fs.unlinkSync(tempCtPath);
            fs.unlinkSync(tempEvaluatedCircuitPath);

            let parsed: any;
            try {
                parsed = JSON.parse(stdout.toString());
            } catch (e: any) {
                console.error("Erreur de parsing JSON depuis compute_proofs_cli:", e, stdout.toString());
                return NextResponse.json(
                    { error: "Erreur serveur: sortie invalide du binaire de calcul de preuves" },
                    { status: 500 }
                );
            }

            return NextResponse.json(parsed);
        } else if (state === 4) {
            // State 4: WaitVendorDataRight - only needs evaluated_circuit
            if (!evaluated_circuit_hex) {
                return NextResponse.json(
                    { error: "Le champ 'evaluated_circuit_hex' est requis pour l'état 4" },
                    { status: 400 }
                );
            }

            const tempEvaluatedCircuitPath = path.join(tempDir, `evaluated_circuit_${contractId}.bin`);
            const evaluated_circuit_bytes = Buffer.from(evaluated_circuit_hex, "hex");
            fs.writeFileSync(tempEvaluatedCircuitPath, evaluated_circuit_bytes);

            // For state 4, we don't need circuit or ct, but CLI still expects them
            // Create dummy files or pass empty strings
            const tempCircuitPath = path.join(tempDir, `circuit_dummy_${contractId}.bin`);
            const tempCtPath = path.join(tempDir, `ct_dummy_${contractId}.bin`);
            fs.writeFileSync(tempCircuitPath, Buffer.alloc(0));
            fs.writeFileSync(tempCtPath, Buffer.alloc(0));

            // Call CLI (challenge is not used for state 4, but CLI expects it)
            const { stdout } = await execFileAsync(COMPUTE_PROOFS_CLI_PATH, [
                "4",
                tempEvaluatedCircuitPath,
                num_blocks.toString(),
                num_gates.toString(),
                tempCircuitPath,
                tempCtPath,
                "0", // Dummy challenge
            ]);

            // Clean up temp files
            fs.unlinkSync(tempEvaluatedCircuitPath);
            fs.unlinkSync(tempCircuitPath);
            fs.unlinkSync(tempCtPath);

            let parsed: any;
            try {
                parsed = JSON.parse(stdout.toString());
            } catch (e: any) {
                console.error("Erreur de parsing JSON depuis compute_proofs_cli:", e, stdout.toString());
                return NextResponse.json(
                    { error: "Erreur serveur: sortie invalide du binaire de calcul de preuves" },
                    { status: 500 }
                );
            }

            return NextResponse.json(parsed);
        }

        return NextResponse.json(
            { error: "État non géré" },
            { status: 400 }
        );
    } catch (error: any) {
        console.error("Erreur dans POST /api/proofs/compute:", error);
        return NextResponse.json(
            { error: `Erreur serveur: ${error.message || error}` },
            { status: 500 }
        );
    }
}
