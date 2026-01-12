"use client";

import Modal from "../common/Modal";
import Button from "../common/Button";
import { Contract } from "./NonAcceptedPrecontractsListView";
import init, { check_precontract } from "@/app/lib/crypto_lib";
import { deriveK2HexForUser, isWrappedCiphertext, unwrapCiphertextBytes } from "@/app/lib/cipher_wrap";
import { bytesToHex, downloadFile, hexToBytes } from "@/app/lib/helpers";

const BLOCK_SIZE = 64;

interface NonAcceptedPrecontractModalProps {
    onClose: () => void;
    contract?: Contract;
    publicKey: string;
}

export default function NonAcceptedPrecontractModal({
    onClose,
    contract,
    publicKey,
}: NonAcceptedPrecontractModalProps) {
    if (!contract) return;
    const {
        id,
        pk_buyer,
        pk_vendor,
        buyer_pubkey,
        vendor_pubkey,
        item_description,
        price,
        tip_completion,
        tip_dispute,
        protocol_version,
        timeout_delay,
        algorithm_suite,
        accepted,
        sponsor,
        commitment,
        opening_value,
        optimistic_smart_contract,
    } = contract;

    const unwrapCiphertextIfNeeded = async (ctBytes: Uint8Array) => {
        if (!isWrappedCiphertext(ctBytes)) {
            return ctBytes;
        }
        const k2Hex = deriveK2HexForUser({
            contractId: id,
            userAddress: publicKey,
            buyerAddress: pk_buyer,
            vendorAddress: pk_vendor,
            buyerPubkey: buyer_pubkey,
            vendorPubkey: vendor_pubkey,
        });
        return await unwrapCiphertextBytes(ctBytes, k2Hex);
    };

    const normalizeHex = (value: string) =>
        value?.startsWith("0x") ? value.slice(2) : value;

    const handleVerifyCommitment = async () => {
        try {
            await init();

            const fileResponse = await fetch(`/api/files/${id}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (!fileResponse.ok) {
                const errorPayload = await fileResponse.json().catch(() => ({}));
                throw new Error(
                    errorPayload?.error ||
                        `Impossible de télécharger le fichier (HTTP ${fileResponse.status})`
                );
            }

            const fileData = await fileResponse.json();
            if (!fileData?.file) {
                throw new Error("Fichier chiffré introuvable (réponse vide).");
            }
            const ctBytes = hexToBytes(fileData.file);
            const unwrapped = await unwrapCiphertextIfNeeded(ctBytes);

            const result = check_precontract(
                normalizeHex(item_description),
                normalizeHex(commitment),
                normalizeHex(opening_value),
                unwrapped
            );

            const success = result.success;
            const hCircuitBytes = new Uint8Array(result.h_circuit);
            const hCtBytes = new Uint8Array(result.h_ct);
            const h_circuit_hex = bytesToHex(hCircuitBytes);
            const h_ct_hex = bytesToHex(hCtBytes);

            if (success) {
                if (
                    confirm(
                        "Commitment is correct! Do you want to save the encrypted file ?"
                    )
                ) {
                    alert(
                        "Commitment correct. Récupération du fichier chiffré à implémenter."
                    );
                }

                localStorage.setItem(`h_circuit_${id}`, h_circuit_hex);
                localStorage.setItem(`h_ct_${id}`, h_ct_hex);
            } else {
                alert("!!! Commitment doesn't match the received file !!!");
            }
        } catch (e: any) {
            console.error("Erreur lors de la vérification du commitment:", e);
            alert(`Erreur vérification commitment: ${e.message || e}`);
        }
    };

    const handleAccept = async () => {
        try {
            // Accepter le contrat
            const acceptResponse = await fetch("/api/precontracts/accept", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ id }),
            });

            if (!acceptResponse.ok) {
                throw new Error(`Erreur lors de l'acceptation du contrat: ${acceptResponse.status}`);
            }

            // Télécharger automatiquement le ciphertext
            try {
                const fileResponse = await fetch(`/api/files/${id}`, {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                    },
                });

                if (fileResponse.ok) {
                    const fileData = await fileResponse.json();
                    if (fileData.file) {
                        const ctBytes = hexToBytes(fileData.file);
                        const unwrapped = await unwrapCiphertextIfNeeded(ctBytes);
                        downloadFile(unwrapped, `contract_${id}_ciphertext.enc`);
                        console.log(`✅ Ciphertext téléchargé pour le contrat ${id}`);
                    }
                } else {
                    console.warn(`⚠️ Impossible de télécharger le ciphertext pour le contrat ${id}`);
                }
            } catch (downloadError: any) {
                console.warn("⚠️ Erreur lors du téléchargement du ciphertext:", downloadError);
                // Ne pas bloquer l'acceptation si le téléchargement échoue
            }

            window.dispatchEvent(new Event("reloadData"));
            alert(`Accepted contract ${id}. Ciphertext downloaded.`);
            onClose();
        } catch (error: any) {
            console.error("❌ Erreur lors de l'acceptation:", error);
            alert(`Erreur lors de l'acceptation: ${error.message || error}`);
        }
    };

    const handleReject = async () => {
        await fetch("/api/precontracts/reject", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ id }),
        });
        window.dispatchEvent(new Event("reloadData"));
        alert(`Rejected contract ${id}`);
        onClose();
    };

    return (
        <Modal title="Non accepted precontract details" onClose={onClose}>
            <div className="space-y-4 grid grid-cols-2 gap-4">
                <div>
                    <strong>Contract ID:</strong> {id}
                </div>
                <div>
                    <strong>Buyer:</strong> {pk_buyer}
                </div>
                <div>
                    <strong>Vendor:</strong> {pk_vendor}
                </div>
                <div>
                    <strong>Item Description:</strong> {item_description}
                </div>
                <div>
                    <strong>Price:</strong> {price}
                </div>
                <div>
                    <strong>Tip Completion:</strong> {tip_completion}
                </div>
                <div>
                    <strong>Tip Dispute:</strong> {tip_dispute}
                </div>
                <div>
                    <strong>Protocol Version:</strong> {protocol_version}
                </div>
                <div>
                    <strong>Timeout Delay:</strong> {timeout_delay}
                </div>
                <div>
                    <strong>Algorithm Suite:</strong> {algorithm_suite}
                </div>
                <div className="col-span-2">
                    <Button
                        label="Verify commitment"
                        onClick={handleVerifyCommitment}
                    />
                </div>

                <div className="col-span-2 flex gap-8">
                    <Button label="Accept" onClick={handleAccept} width="1/2" />
                    <Button label="Reject" onClick={handleReject} width="1/2" />
                </div>
            </div>
        </Modal>
    );
}
