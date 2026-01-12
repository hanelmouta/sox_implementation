import { UPLOADS_PATH, WASM_PATH } from "@/app/api/files/[id]/route";
import { bytes_to_hex, hex_to_bytes, initSync } from "@/app/lib/crypto_lib";
import db from "@/app/lib/sqlite";
import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "node:fs";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const fileName = `argument_vendor_${id}.bin`;
        
        // Vérifier si le fichier existe
        const filePath = `${UPLOADS_PATH}${fileName}`;
        let argument: Buffer;
        try {
            argument = readFileSync(filePath);
        } catch (fileError) {
            return NextResponse.json(
                { error: `Argument file not found for contract ${id}` },
                { status: 404 }
            );
        }

        const module = readFileSync(`${WASM_PATH}crypto_lib_bg.wasm`);
        initSync({ module: module });

        const stmt = db.prepare(
            "SELECT item_description FROM contracts WHERE id = ?"
        );
        const resp = stmt.all(id);

        if (!resp || resp.length === 0) {
            return NextResponse.json(
                { error: `Contract ${id} not found in database` },
                { status: 404 }
            );
        }

        const { item_description } = resp[0] as { item_description: string };

        return NextResponse.json({
            argument: bytes_to_hex(argument),
            description: item_description,
        });
    } catch (error: any) {
        console.error("Error in GET /api/arguments/vendor/[id]:", error);
        return NextResponse.json(
            { error: error?.message || "Internal server error" },
            { status: 500 }
        );
    }
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const module = readFileSync(`${WASM_PATH}crypto_lib_bg.wasm`);
    initSync({ module: module });

    const { argument } = await req.json();
    const { id } = await params;

    const fileName = `argument_vendor_${id}.bin`;
    writeFileSync(`${UPLOADS_PATH}${fileName}`, hex_to_bytes(argument));

    return NextResponse.json({ message: "success" });
}
