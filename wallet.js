// wallet.js — thin wrapper around the injected Phantom / Solflare providers.
// Both wallets inject a window.solana (Phantom) / window.solflare object that
// implements the same basic interface: connect(), signTransaction(),
// signAllTransactions(), and a `publicKey` property once connected.

import { Connection, PublicKey, clusterApiUrl } from "https://esm.sh/@solana/web3.js@1.95.3";

export const state = {
  provider: null,      // the raw injected provider object
  providerName: null,  // "Phantom" | "Solflare"
  publicKey: null,      // web3.PublicKey
  connection: null,     // web3.Connection
};

const listeners = new Set();

export function onWalletChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) cb(state);
}

function detectProviders() {
  const found = [];
  if (window?.solana?.isPhantom) found.push({ name: "Phantom", provider: window.solana });
  if (window?.solflare?.isSolflare) found.push({ name: "Solflare", provider: window.solflare });
  // Fallback: some Solflare versions only expose window.solflare without isSolflare flag
  if (!found.length && window?.solflare) found.push({ name: "Solflare", provider: window.solflare });
  return found;
}

export function getRpcEndpoint() {
  const input = document.getElementById("rpcInput");
  const val = input?.value?.trim();
  return val || clusterApiUrl("mainnet-beta");
}

export function getConnection() {
  if (!state.connection) {
    state.connection = new Connection(getRpcEndpoint(), "confirmed");
  }
  return state.connection;
}

export function refreshConnection() {
  state.connection = new Connection(getRpcEndpoint(), "confirmed");
  return state.connection;
}

export async function connectWallet() {
  const found = detectProviders();

  if (found.length === 0) {
    throw new Error(
      "No wallet found. Install the Phantom or Solflare browser extension, then reload this page."
    );
  }

  // If multiple wallets are installed, prefer Phantom by default.
  const chosen = found.find((f) => f.name === "Phantom") || found[0];

  const resp = await chosen.provider.connect();
  const pubkey = resp?.publicKey || chosen.provider.publicKey;
  if (!pubkey) throw new Error("Wallet connected but returned no public key.");

  state.provider = chosen.provider;
  state.providerName = chosen.name;
  state.publicKey = new PublicKey(pubkey.toString());
  state.connection = getConnection();

  chosen.provider.on?.("disconnect", () => {
    disconnectWallet();
  });
  chosen.provider.on?.("accountChanged", (newPk) => {
    if (newPk) {
      state.publicKey = new PublicKey(newPk.toString());
    } else {
      disconnectWallet();
    }
    notify();
  });

  notify();
  return state;
}

export function disconnectWallet() {
  try {
    state.provider?.disconnect?.();
  } catch (_) {
    /* no-op */
  }
  state.provider = null;
  state.providerName = null;
  state.publicKey = null;
  notify();
}

/** Wallet adapter shape expected by @metaplex-foundation/js's walletAdapterIdentity() */
export function getWalletAdapter() {
  if (!state.provider || !state.publicKey) return null;
  return {
    publicKey: state.publicKey,
    signTransaction: (tx) => state.provider.signTransaction(tx),
    signAllTransactions: (txs) => state.provider.signAllTransactions(txs),
  };
}

export async function getSolBalance() {
  if (!state.publicKey) return 0;
  const conn = getConnection();
  const lamports = await conn.getBalance(state.publicKey, "confirmed");
  return lamports / 1_000_000_000;
}
