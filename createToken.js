// createToken.js
// Builds and sends the transactions needed to launch a fully-standard SPL
// token with Metaplex metadata, then (optionally) revokes mint / freeze /
// update authority so the token reads as fully locked on explorers.
//
// Image + metadata JSON are uploaded to Arweave through Bundlr, using only
// the storage driver of @metaplex-foundation/js (we don't use its higher
// level nft/sft builders — the on-chain instructions below are built
// directly against @solana/spl-token and @metaplex-foundation/mpl-token-metadata
// so the exact authority-revocation steps are explicit and auditable).

import {
  Connection,
  Transaction,
  SystemProgram,
  Keypair,
  PublicKey,
} from "https://esm.sh/@solana/web3.js@1.95.3";

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getAssociatedTokenAddress,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from "https://esm.sh/@solana/spl-token@0.4.8";

import {
  createCreateMetadataAccountV3Instruction,
  createUpdateMetadataAccountV2Instruction,
} from "https://esm.sh/@metaplex-foundation/mpl-token-metadata@2.13.0";

import { Metaplex, walletAdapterIdentity, bundlrStorage, toMetaplexFile } from "https://esm.sh/@metaplex-foundation/js@0.20.1";

import { state, getConnection, getWalletAdapter, getRpcEndpoint } from "./wallet.js";
import { log, logLink, setStep, solscanAddr } from "./ui.js";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const enc = (s) => new TextEncoder().encode(s);

function metadataPda(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [enc("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

async function signAndSend(connection, wallet, tx, extraSigners = []) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  if (extraSigners.length) tx.partialSign(...extraSigners);
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

/**
 * @param {object} form - collected form values
 * @param {File} form.logoFile
 * @param {string} form.name
 * @param {string} form.symbol
 * @param {string} form.description
 * @param {number} form.decimals
 * @param {string} form.supply  (raw string, whole tokens)
 * @param {string} form.website
 * @param {boolean} form.revokeMint
 * @param {boolean} form.revokeFreeze
 * @param {boolean} form.revokeUpdate
 * @param {object} els - { rail, terminal, resultBox, resultMint, resultSolscan }
 */
export async function createToken(form, els) {
  if (!state.publicKey || !state.provider) throw new Error("Connect a wallet first.");
  const connection = getConnection();
  const wallet = getWalletAdapter();
  const { rail, terminal } = els;

  // ---------- Step 1: upload logo + metadata JSON to Arweave ----------
  setStep(rail, "upload", "active");
  log(terminal, "Preparing Metaplex/Bundlr storage driver…");

  const metaplex = Metaplex.make(connection)
    .use(walletAdapterIdentity(wallet))
    .use(bundlrStorage({
      address: "https://node1.bundlr.network",
      providerUrl: getRpcEndpoint(),
      timeout: 120000,
    }));

  let imageUri, metadataUri;
  try {
    const buf = new Uint8Array(await form.logoFile.arrayBuffer());
    const mxFile = toMetaplexFile(buf, form.logoFile.name, { contentType: form.logoFile.type });
    log(terminal, `Uploading logo (${form.logoFile.name}, ${(form.logoFile.size / 1024).toFixed(1)} KB) to Arweave via Bundlr…`);
    imageUri = await metaplex.storage().upload(mxFile);
    log(terminal, `Logo uploaded.`, "ok");
    logLink(terminal, "Image URI:", imageUri);

    const metadataJson = {
      name: form.name,
      symbol: form.symbol,
      description: form.description,
      image: imageUri,
      external_url: form.website || undefined,
      properties: {
        files: [{ uri: imageUri, type: form.logoFile.type }],
        category: "image",
      },
    };
    log(terminal, "Uploading token metadata JSON to Arweave…");
    metadataUri = await metaplex.storage().uploadJson(metadataJson);
    log(terminal, "Metadata JSON uploaded.", "ok");
    logLink(terminal, "Metadata URI:", metadataUri);
    setStep(rail, "upload", "done");
  } catch (err) {
    setStep(rail, "upload", "error");
    log(terminal, `Arweave upload failed: ${err.message || err}`, "err");
    throw err;
  }

  // ---------- Step 2: create mint account ----------
  setStep(rail, "mint", "active");
  const mintKeypair = Keypair.generate();
  const decimals = Number(form.decimals);
  let mintSig;
  try {
    const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mintKeypair.publicKey,
        decimals,
        wallet.publicKey, // mint authority
        wallet.publicKey, // freeze authority
        TOKEN_PROGRAM_ID
      )
    );
    mintSig = await signAndSend(connection, wallet, tx, [mintKeypair]);
    log(terminal, `Mint account created: ${mintKeypair.publicKey.toBase58()}`, "ok");
    logLink(terminal, "Tx:", `https://solscan.io/tx/${mintSig}`);
    setStep(rail, "mint", "done");
  } catch (err) {
    setStep(rail, "mint", "error");
    log(terminal, `Mint creation failed: ${err.message || err}`, "err");
    throw err;
  }

  const mint = mintKeypair.publicKey;

  // ---------- Step 3: attach Metaplex metadata ----------
  setStep(rail, "metadata", "active");
  try {
    const pda = metadataPda(mint);
    const ix = createCreateMetadataAccountV3Instruction(
      {
        metadata: pda,
        mint,
        mintAuthority: wallet.publicKey,
        payer: wallet.publicKey,
        updateAuthority: wallet.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name: form.name,
            symbol: form.symbol,
            uri: metadataUri,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          isMutable: true,
          collectionDetails: null,
        },
      }
    );
    const tx = new Transaction().add(ix);
    const sig = await signAndSend(connection, wallet, tx);
    log(terminal, "Metadata account created.", "ok");
    logLink(terminal, "Tx:", `https://solscan.io/tx/${sig}`);
    setStep(rail, "metadata", "done");
  } catch (err) {
    setStep(rail, "metadata", "error");
    log(terminal, `Metadata creation failed: ${err.message || err}`, "err");
    throw err;
  }

  // ---------- Step 4: mint total supply to creator wallet ----------
  setStep(rail, "supply", "active");
  try {
    const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);
    const rawSupply = BigInt(form.supply) * 10n ** BigInt(decimals);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet.publicKey, ata, wallet.publicKey, mint),
      createMintToInstruction(mint, ata, wallet.publicKey, rawSupply)
    );
    const sig = await signAndSend(connection, wallet, tx);
    log(terminal, `Minted ${form.supply} ${form.symbol} to your wallet.`, "ok");
    logLink(terminal, "Tx:", `https://solscan.io/tx/${sig}`);
    setStep(rail, "supply", "done");
  } catch (err) {
    setStep(rail, "supply", "error");
    log(terminal, `Minting supply failed: ${err.message || err}`, "err");
    throw err;
  }

  // ---------- Step 5-7: revoke authorities ----------
  const revokeSteps = [
    {
      key: "revoke-mint",
      enabled: form.revokeMint,
      run: async () => {
        const ix = createSetAuthorityInstruction(mint, wallet.publicKey, AuthorityType.MintTokens, null);
        return signAndSend(connection, wallet, new Transaction().add(ix));
      },
      label: "Mint authority revoked — total supply is now fixed forever.",
    },
    {
      key: "revoke-freeze",
      enabled: form.revokeFreeze,
      run: async () => {
        const ix = createSetAuthorityInstruction(mint, wallet.publicKey, AuthorityType.FreezeAccount, null);
        return signAndSend(connection, wallet, new Transaction().add(ix));
      },
      label: "Freeze authority revoked — holder accounts can never be frozen.",
    },
    {
      key: "revoke-update",
      enabled: form.revokeUpdate,
      run: async () => {
        const pda = metadataPda(mint);
        const ix = createUpdateMetadataAccountV2Instruction(
          { metadata: pda, updateAuthority: wallet.publicKey },
          {
            updateMetadataAccountArgsV2: {
              data: null,
              updateAuthority: PublicKey.default,
              primarySaleHappened: null,
              isMutable: false,
            },
          }
        );
        return signAndSend(connection, wallet, new Transaction().add(ix));
      },
      label: "Update authority revoked — metadata is now permanently immutable.",
    },
  ];

  for (const step of revokeSteps) {
    if (!step.enabled) {
      setStep(rail, step.key, "done");
      log(terminal, `Skipped (left unrevoked by choice): ${step.key}`, "warn");
      continue;
    }
    setStep(rail, step.key, "active");
    try {
      const sig = await step.run();
      log(terminal, step.label, "ok");
      logLink(terminal, "Tx:", `https://solscan.io/tx/${sig}`);
      setStep(rail, step.key, "done");
    } catch (err) {
      setStep(rail, step.key, "error");
      log(terminal, `${step.key} failed: ${err.message || err}`, "err");
      throw err;
    }
  }

  log(terminal, `Token launch complete: ${mint.toBase58()}`, "ok");

  return {
    mint: mint.toBase58(),
    solscanUrl: solscanAddr(mint.toBase58()),
  };
}
