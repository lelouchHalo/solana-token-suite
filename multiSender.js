// multiSender.js — bulk-send SOL or a single SPL token to a list of
// recipients in batches of 6 per transaction.

import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "https://esm.sh/@solana/web3.js@1.95.3";

import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getMint,
  ACCOUNT_SIZE,
} from "https://esm.sh/@solana/spl-token@0.4.8";

import { state, getConnection, getWalletAdapter } from "./wallet.js";
import { log, logLink, sleep } from "./ui.js";

export const BATCH_SIZE = 6;
const LAMPORTS_PER_SIGNATURE = 5000;

export function parseAddresses(raw) {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Validates addresses, checks ATA existence for SPL sends, and estimates
 * total network cost.
 */
export async function checkAndEstimate({ asset, mintAddress, decimals, addresses }) {
  const connection = getConnection();
  const valid = [];
  const invalid = [];

  for (const addr of addresses) {
    try {
      valid.push(new PublicKey(addr));
    } catch {
      invalid.push(addr);
    }
  }

  let newAtaCount = 0;
  let mintPubkey = null;

  if (asset === "SPL") {
    mintPubkey = new PublicKey(mintAddress);
    // Derive ATA for each valid recipient, then batch-check existence.
    const atas = await Promise.all(valid.map((owner) => getAssociatedTokenAddress(mintPubkey, owner)));
    const infoChunks = chunk(atas, 100);
    const existing = [];
    for (const c of infoChunks) {
      const infos = await connection.getMultipleAccountsInfo(c);
      existing.push(...infos);
    }
    newAtaCount = existing.filter((info) => info === null).length;
  }

  const numBatches = Math.ceil(valid.length / BATCH_SIZE) || 0;
  const baseFeeLamports = numBatches * LAMPORTS_PER_SIGNATURE;

  let ataRentLamports = 0;
  if (asset === "SPL" && newAtaCount > 0) {
    ataRentLamports = (await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE)) * newAtaCount;
  }

  let transferLamports = 0;
  if (asset === "SOL") {
    // informational only — not a "fee", but relevant to total SOL required
    transferLamports = 0;
  }

  const totalFeeSol = (baseFeeLamports + ataRentLamports + transferLamports) / LAMPORTS_PER_SOL;

  return {
    valid,
    invalid,
    newAtaCount,
    numBatches,
    totalFeeSol,
    mintPubkey,
  };
}

export async function autoDetectDecimals(mintAddress) {
  const connection = getConnection();
  const mintPubkey = new PublicKey(mintAddress);
  const info = await getMint(connection, mintPubkey);
  return info.decimals;
}

async function signAndSend(connection, wallet, tx) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

/**
 * Sends `amountPerWallet` (human units) of SOL or an SPL token to every
 * recipient in `recipients`, batched BATCH_SIZE at a time.
 *
 * @param {object} opts
 * @param {"SOL"|"SPL"} opts.asset
 * @param {PublicKey[]} opts.recipients
 * @param {string} opts.amountPerWallet - human-readable amount, per wallet
 * @param {number} opts.decimals
 * @param {PublicKey|null} opts.mintPubkey
 * @param {(update: object) => void} opts.onProgress - called after each batch
 */
export async function sendToAll({ asset, recipients, amountPerWallet, decimals, mintPubkey, onProgress, terminal }) {
  if (!state.publicKey || !state.provider) throw new Error("Connect a wallet first.");
  const connection = getConnection();
  const wallet = getWalletAdapter();
  const batches = chunk(recipients, BATCH_SIZE);

  const rawAmount = asset === "SOL"
    ? BigInt(Math.round(Number(amountPerWallet) * LAMPORTS_PER_SOL))
    : BigInt(Math.round(Number(amountPerWallet) * 10 ** decimals));

  let sourceAta = null;
  if (asset === "SPL") {
    sourceAta = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey);
  }

  const results = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const tx = new Transaction();

    if (asset === "SOL") {
      for (const dest of batch) {
        tx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: dest, lamports: rawAmount }));
      }
    } else {
      for (const dest of batch) {
        const destAta = await getAssociatedTokenAddress(mintPubkey, dest);
        const info = await connection.getAccountInfo(destAta);
        if (!info) {
          tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, destAta, dest, mintPubkey));
        }
        tx.add(createTransferCheckedInstruction(sourceAta, mintPubkey, destAta, wallet.publicKey, rawAmount, decimals));
      }
    }

    try {
      const sig = await signAndSend(connection, wallet, tx);
      results.push({ batchIndex: i, addresses: batch.map((p) => p.toBase58()), signature: sig, status: "ok" });
      if (terminal) logLink(terminal, `Batch ${i + 1}/${batches.length} confirmed —`, `https://solscan.io/tx/${sig}`);
    } catch (err) {
      results.push({ batchIndex: i, addresses: batch.map((p) => p.toBase58()), error: err.message || String(err), status: "error" });
      if (terminal) log(terminal, `Batch ${i + 1}/${batches.length} failed: ${err.message || err}`, "err");
    }

    onProgress?.({ completed: i + 1, total: batches.length, result: results[results.length - 1] });
    await sleep(250); // small delay between batches for RPC friendliness
  }

  return results;
}
