# Solana Token Suite

A fully client-side, static web app for **creating SPL tokens with Metaplex metadata**
and **bulk-sending SOL or SPL tokens** to a list of addresses. No backend, no build
step — deploys straight to GitHub Pages.

⚠️ **This app operates on Solana Mainnet by default and moves real funds.**
Test with small amounts first, and read the "Safety notes" section below before
using it for anything real.

## What's inside

```
index.html         Page shell, both tabs
style.css           Dark "ledger/terminal" UI
js/wallet.js        Phantom / Solflare connection + RPC handling
js/ui.js            Shared logging / step-rail helpers
js/createToken.js   Arweave upload + mint + metadata + authority revocation
js/multiSender.js   Address validation, fee estimate, batched transfers
js/main.js          Wires the DOM to the above modules
```

All Solana/Metaplex libraries are loaded at runtime from
[esm.sh](https://esm.sh) as native ES modules — there is nothing to `npm install`
and nothing to bundle. Open `index.html` in a static file server (or GitHub Pages)
and it works as-is.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository (root, or a `/docs` folder).
2. In the repo: **Settings → Pages → Source**, pick the branch/folder that contains
   `index.html`.
3. Wait a minute for the deployment, then visit the URL GitHub gives you.

That's it — no CI, no build step.

## Using it locally first

Because it uses ES module `import`, you can't open `index.html` via `file://` —
browsers block module imports from the local filesystem. Serve it locally instead:

```bash
cd solana-token-suite
python3 -m http.server 8080
# then open http://localhost:8080
```

## RPC endpoint

The public `https://api.mainnet-beta.solana.com` endpoint is rate-limited and will
fail under real usage (especially the Multi Sender's per-address account checks).
Get a free/paid RPC URL from a provider (Helius, QuickNode, Triton, Alchemy, etc.)
and paste it into the **RPC** field at the top of the page — it's saved only in the
page, not persisted, so you'll re-enter it each session unless you hardcode a default
in `js/wallet.js`.

## How Create Token works

1. Uploads your logo and a generated metadata JSON file to Arweave via Bundlr,
   paid for in SOL from your connected wallet (this is the same mechanism most
   token launchpads use).
2. Creates a new SPL mint account (`decimals` you specify).
3. Attaches a Metaplex Token Metadata account (v3) pointing at the Arweave JSON,
   so the name/symbol/logo show up on Solscan, Phantom, Solflare, Jupiter, etc.
4. Mints your entire specified supply to your own wallet.
5. Optionally revokes mint authority, freeze authority, and/or metadata update
   authority — each is its own on-chain transaction so you can see exactly what
   happened. **Revocation is permanent and cannot be undone.**

Each stage signs and sends its own transaction, shown live in the "Ledger" panel.

## How Multi Sender works

- Paste any number of addresses (newline- or comma-separated).
- Pick SOL or an SPL token (paste the mint; decimals can be auto-detected from
  the mint account).
- **Check & Estimate Fees** validates every address, checks which recipients
  already have an associated token account (ATA) for SPL sends, and estimates
  total network + rent cost.
- Sending batches recipients 6-per-transaction (configurable in
  `js/multiSender.js` via `BATCH_SIZE`) — SOL transfers batch as plain
  `SystemProgram.transfer` instructions; SPL transfers add an
  `createAssociatedTokenAccount` instruction per recipient that doesn't yet
  have one, then a `transferChecked` instruction.
- Every batch's signature is shown as a clickable Solscan link, with a running
  progress bar.

## Safety notes

- **This is mainnet software.** Every transaction costs real SOL and, once
  confirmed, cannot be reversed.
- **Revoking authorities is permanent.** Double-check name, symbol, decimals,
  and supply before you click Create — you cannot edit a token after its
  update authority is revoked.
- **Double-check pasted addresses.** The estimator validates base58 format
  only; it cannot tell you an address is the *intended* recipient.
- Keys never touch this app or leave your wallet extension — all signing
  happens inside Phantom/Solflare.
- Consider testing the whole flow on **devnet** first by pointing the RPC
  field at a devnet endpoint (e.g. `https://api.devnet.solana.com`) and
  switching your wallet to devnet — note the Solscan links in the UI assume
  mainnet and won't resolve for devnet transactions.
- This code is provided as a starting point; review it (or have it audited)
  before using it with meaningful sums.

## Customizing

- **Batch size** — change `BATCH_SIZE` in `js/multiSender.js`. Larger batches
  mean fewer signatures/fees but a higher chance of hitting Solana's ~1232-byte
  transaction size limit, especially for SPL sends that also create ATAs.
- **Default RPC** — change the default value of the `#rpcInput` field in
  `index.html`.
- **Bundlr / Arweave network** — `js/createToken.js` uses
  `https://node1.bundlr.network` (mainnet). See the Irys/Bundlr docs if that
  endpoint has moved.
