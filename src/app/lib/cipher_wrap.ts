import { SigningKey, concat, getBytes, sha256, toUtf8Bytes } from "ethers";
import { PK_SK_MAP } from "./blockchain/config";
import { concatBytes } from "./helpers";

const MAGIC = new TextEncoder().encode("SOX2");
const IV_LENGTH = 12;

function getPrivateKeyForAddress(address: string): string {
    const direct = PK_SK_MAP.get(address);
    if (direct) {
        return direct as string;
    }
    const lower = address.toLowerCase();
    for (const [pk, sk] of PK_SK_MAP.entries()) {
        if (pk.toLowerCase() === lower) {
            return sk as string;
        }
    }
    throw new Error(`Private key not found for address: ${address}`);
}

export function getPublicKeyForAddress(address: string): string {
    const privateKey = getPrivateKeyForAddress(address);
    return new SigningKey(privateKey).publicKey;
}

export function deriveK2Hex(
    privateKey: string,
    otherPublicKey: string,
    contractId: number | string
): string {
    const signingKey = new SigningKey(privateKey);
    const sharedSecret = signingKey.computeSharedSecret(otherPublicKey);
    const info = toUtf8Bytes(`SOX-K2:${contractId}`);
    return sha256(concat([sharedSecret, info]));
}

export function deriveK2HexForUser(params: {
    contractId: number | string;
    userAddress: string;
    buyerAddress: string;
    vendorAddress: string;
    buyerPubkey?: string | null;
    vendorPubkey?: string | null;
}): string {
    const {
        contractId,
        userAddress,
        buyerAddress,
        vendorAddress,
        buyerPubkey,
        vendorPubkey,
    } = params;
    const userLower = userAddress.toLowerCase();
    const buyerLower = buyerAddress.toLowerCase();
    const vendorLower = vendorAddress.toLowerCase();
    const privateKey = getPrivateKeyForAddress(userAddress);
    let otherPubkey: string | null | undefined = null;

    if (userLower === buyerLower) {
        otherPubkey = vendorPubkey;
    } else if (userLower === vendorLower) {
        otherPubkey = buyerPubkey;
    } else {
        throw new Error("User is neither buyer nor vendor for this contract.");
    }

    if (!otherPubkey) {
        throw new Error("Missing counterparty public key for K2 derivation.");
    }

    return deriveK2Hex(privateKey, otherPubkey, contractId);
}

export function isWrappedCiphertext(data: Uint8Array): boolean {
    if (data.length <= MAGIC.length + IV_LENGTH) {
        return false;
    }
    for (let i = 0; i < MAGIC.length; i += 1) {
        if (data[i] !== MAGIC[i]) {
            return false;
        }
    }
    return true;
}

export async function wrapCiphertextBytes(
    data: Uint8Array,
    k2Hex: string
): Promise<Uint8Array> {
    if (!globalThis.crypto?.subtle) {
        throw new Error("WebCrypto is not available for encryption.");
    }
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        getBytes(k2Hex),
        { name: "AES-GCM" },
        false,
        ["encrypt"]
    );
    const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        data
    );
    const header = new Uint8Array(MAGIC.length + IV_LENGTH);
    header.set(MAGIC, 0);
    header.set(iv, MAGIC.length);
    return concatBytes([header, new Uint8Array(encrypted)]);
}

export async function unwrapCiphertextBytes(
    data: Uint8Array,
    k2Hex: string
): Promise<Uint8Array> {
    if (!isWrappedCiphertext(data)) {
        return data;
    }
    if (!globalThis.crypto?.subtle) {
        throw new Error("WebCrypto is not available for decryption.");
    }
    const ivStart = MAGIC.length;
    const ivEnd = MAGIC.length + IV_LENGTH;
    const iv = data.slice(ivStart, ivEnd);
    const encrypted = data.slice(ivEnd);
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        getBytes(k2Hex),
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );
    const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        encrypted
    );
    return new Uint8Array(decrypted);
}
