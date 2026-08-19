import { connectWallet, disconnectWallet, onWalletChange, state, getSolBalance, refreshConnection } from "./wallet.js";
import { createToken } from "./createToken.js";
import { parseAddresses, checkAndEstimate, autoDetectDecimals, sendToAll, BATCH_SIZE } from "./multiSender.js";
import { log, setStep, shortAddr } from "./ui.js";

/* ---------------------------------------------------------------- */
/* Tabs                                                              */
/* ---------------------------------------------------------------- */
const tabBtnCreate = document.getElementById("tabBtnCreate");
const tabBtnSend = document.getElementById("tabBtnSend");
const panelCreate = document.getElementById("panelCreate");
const panelSend = document.getElementById("panelSend");

function activateTab(name) {
  const creating = name === "create";
  tabBtnCreate.classList.toggle("active", creating);
  tabBtnSend.classList.toggle("active", !creating);
  tabBtnCreate.setAttribute("aria-selected", String(creating));
  tabBtnSend.setAttribute("aria-selected", String(!creating));
  panelCreate.classList.toggle("active", creating);
  panelSend.classList.toggle("active", !creating);
  panelCreate.hidden = !creating;
  panelSend.hidden = creating;
}
tabBtnCreate.addEventListener("click", () => activateTab("create"));
tabBtnSend.addEventListener("click", () => activateTab("send"));

/* ---------------------------------------------------------------- */
/* Wallet connect                                                    */
/* ---------------------------------------------------------------- */
const connectBtn = document.getElementById("connectBtn");
const walletBalanceEl = document.getElementById("walletBalance");
const createTokenBtn = document.getElementById("createTokenBtn");
const estimateBtn = document.getElementById("estimateBtn");
const rpcInput = document.getElementById("rpcInput");

rpcInput.addEventListener("change", () => refreshConnection());

connectBtn.addEventListener("click", async () => {
  if (state.publicKey) {
    disconnectWallet();
    return;
  }
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting…";
  try {
    await connectWallet();
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    connectBtn.disabled = false;
  }
});

onWalletChange(async (s) => {
  if (s.publicKey) {
    connectBtn.textContent = `${shortAddr(s.publicKey.toBase58())} · Disconnect`;
    connectBtn.classList.remove("btn-primary");
    connectBtn.classList.add("btn-outline");
    createTokenBtn.disabled = false;
    createTokenBtn.textContent = "Create Token";
    estimateBtn.disabled = false;
    walletBalanceEl.classList.remove("hidden");
    try {
      const bal = await getSolBalance();
      walletBalanceEl.textContent = `${bal.toFixed(3)} SOL`;
    } catch {
      walletBalanceEl.textContent = "— SOL";
    }
  } else {
    connectBtn.textContent = "Connect Wallet";
    connectBtn.classList.add("btn-primary");
    connectBtn.classList.remove("btn-outline");
    createTokenBtn.disabled = true;
    createTokenBtn.textContent = "Connect Wallet to Continue";
    estimateBtn.disabled = true;
    document.getElementById("sendBtn").disabled = true;
    walletBalanceEl.classList.add("hidden");
  }
});

/* ---------------------------------------------------------------- */
/* Create Token tab                                                  */
/* ---------------------------------------------------------------- */
const logoInput = document.getElementById("tokenLogo");
const logoDrop = document.getElementById("logoDrop");
const logoPreview = document.getElementById("logoPreview");
const logoDropText = document.getElementById("logoDropText");
let selectedLogoFile = null;

logoDrop.addEventListener("dragover", (e) => { e.preventDefault(); logoDrop.style.borderColor = "var(--accent)"; });
logoDrop.addEventListener("dragleave", () => { logoDrop.style.borderColor = ""; });
logoDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  logoDrop.style.borderColor = "";
  const file = e.dataTransfer.files?.[0];
  if (file) handleLogoFile(file);
});
logoInput.addEventListener("change", () => {
  const file = logoInput.files?.[0];
  if (file) handleLogoFile(file);
});
function handleLogoFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    return;
  }
  selectedLogoFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    logoPreview.src = reader.result;
    logoPreview.classList.remove("hidden");
    logoDropText.classList.add("hidden");
  };
  reader.readAsDataURL(file);
}

const createRail = document.getElementById("createSteps");
const createTerminal = document.getElementById("createTerminal");
const createResult = document.getElementById("createResult");
const resultMint = document.getElementById("resultMint");
const resultSolscan = document.getElementById("resultSolscan");

createTokenBtn.addEventListener("click", async () => {
  const name = document.getElementById("tokenName").value.trim();
  const symbol = document.getElementById("tokenSymbol").value.trim().toUpperCase();
  const description = document.getElementById("tokenDesc").value.trim();
  const decimals = document.getElementById("tokenDecimals").value;
  const supply = document.getElementById("tokenSupply").value.trim().replace(/,/g, "");
  const website = document.getElementById("tokenSocials").value.trim();
  const revokeMint = document.getElementById("revokeMint").checked;
  const revokeFreeze = document.getElementById("revokeFreeze").checked;
  const revokeUpdate = document.getElementById("revokeUpdate").checked;

  if (!selectedLogoFile) return alert("Please choose a token logo image.");
  if (!name) return alert("Enter a token name.");
  if (!symbol) return alert("Enter a ticker/symbol.");
  if (!supply || !/^\d+$/.test(supply)) return alert("Total supply must be a whole number.");
  if (decimals === "" || Number(decimals) < 0 || Number(decimals) > 9) return alert("Decimals must be between 0 and 9.");

  // reset rail
  createRail.querySelectorAll("li").forEach((li) => {
    li.classList.remove("active", "done", "error");
    li.querySelector(".step-status").textContent = "—";
  });
  createTerminal.innerHTML = "";
  createResult.classList.add("hidden");
  createTokenBtn.disabled = true;
  createTokenBtn.textContent = "Launching…";

  try {
    const result = await createToken(
      {
        logoFile: selectedLogoFile,
        name,
        symbol,
        description,
        decimals,
        supply,
        website,
        revokeMint,
        revokeFreeze,
        revokeUpdate,
      },
      { rail: createRail, terminal: createTerminal }
    );
    resultMint.textContent = result.mint;
    resultSolscan.href = result.solscanUrl;
    createResult.classList.remove("hidden");
    createTokenBtn.textContent = "Token Launched ✓";
  } catch (err) {
    console.error(err);
    createTokenBtn.textContent = "Create Token";
    createTokenBtn.disabled = false;
  }
});

/* ---------------------------------------------------------------- */
/* Multi Sender tab                                                  */
/* ---------------------------------------------------------------- */
const assetToggle = document.getElementById("assetToggle");
const mintField = document.getElementById("mintField");
const decimalsRow = document.getElementById("decimalsRow");
const mintAddressInput = document.getElementById("mintAddress");
const mintDecimalsInput = document.getElementById("mintDecimals");
const autoDecimalsBtn = document.getElementById("autoDecimalsBtn");
const recipientList = document.getElementById("recipientList");
const addrCount = document.getElementById("addrCount");
const amountInput = document.getElementById("amountPerWallet");
const sendTerminal = document.getElementById("sendTerminal");

let currentAsset = "SOL";
let lastEstimate = null;

assetToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  currentAsset = btn.dataset.asset;
  assetToggle.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
  const isSpl = currentAsset === "SPL";
  mintField.classList.toggle("hidden", !isSpl);
  decimalsRow.hidden = !isSpl;
  document.getElementById("estimateBox").classList.add("hidden");
  document.getElementById("sendBtn").disabled = true;
});

recipientList.addEventListener("input", () => {
  const n = parseAddresses(recipientList.value).length;
  addrCount.textContent = `${n} address${n === 1 ? "" : "es"}`;
});

autoDecimalsBtn.addEventListener("click", async () => {
  const mint = mintAddressInput.value.trim();
  if (!mint) return alert("Paste a mint address first.");
  autoDecimalsBtn.disabled = true;
  autoDecimalsBtn.textContent = "…";
  try {
    const d = await autoDetectDecimals(mint);
    mintDecimalsInput.value = d;
  } catch (err) {
    alert(`Couldn't read mint: ${err.message || err}`);
  } finally {
    autoDecimalsBtn.disabled = false;
    autoDecimalsBtn.textContent = "Auto-detect";
  }
});

const estimateBox = document.getElementById("estimateBox");
const eValid = document.getElementById("eValid");
const eInvalid = document.getElementById("eInvalid");
const eNewAta = document.getElementById("eNewAta");
const eCost = document.getElementById("eCost");
const invalidList = document.getElementById("invalidList");
const sendBtn = document.getElementById("sendBtn");

estimateBtn.addEventListener("click", async () => {
  const addresses = parseAddresses(recipientList.value);
  if (addresses.length === 0) return alert("Paste at least one recipient address.");
  if (currentAsset === "SPL" && !mintAddressInput.value.trim()) return alert("Enter the SPL token mint address.");

  estimateBtn.disabled = true;
  estimateBtn.textContent = "Checking…";
  try {
    const est = await checkAndEstimate({
      asset: currentAsset,
      mintAddress: mintAddressInput.value.trim(),
      decimals: Number(mintDecimalsInput.value || 0),
      addresses,
    });
    lastEstimate = est;

    eValid.textContent = est.valid.length;
    eInvalid.textContent = est.invalid.length;
    eNewAta.textContent = currentAsset === "SPL" ? est.newAtaCount : "—";
    eCost.textContent = `${est.totalFeeSol.toFixed(5)} SOL`;

    if (est.invalid.length > 0) {
      invalidList.classList.remove("hidden");
      invalidList.innerHTML = est.invalid.map((a) => `<div>✕ ${a}</div>`).join("");
    } else {
      invalidList.classList.add("hidden");
    }

    estimateBox.classList.remove("hidden");
    sendBtn.disabled = est.valid.length === 0 || !amountInput.value;
  } catch (err) {
    alert(`Estimate failed: ${err.message || err}`);
  } finally {
    estimateBtn.disabled = false;
    estimateBtn.textContent = "Check & Estimate Fees";
  }
});

amountInput.addEventListener("input", () => {
  sendBtn.disabled = !lastEstimate || lastEstimate.valid.length === 0 || !amountInput.value;
});

const progressFill = document.getElementById("sendProgressFill");
const progressLabel = document.getElementById("sendProgressLabel");
const batchList = document.getElementById("batchList");

sendBtn.addEventListener("click", async () => {
  if (!lastEstimate || lastEstimate.valid.length === 0) return;
  const amount = amountInput.value.trim();
  if (!amount || Number(amount) <= 0) return alert("Enter a valid amount per wallet.");

  const confirmed = confirm(
    `You are about to send ${amount} ${currentAsset === "SOL" ? "SOL" : "tokens"} to ${lastEstimate.valid.length} wallet(s) on MAINNET. This cannot be undone. Continue?`
  );
  if (!confirmed) return;

  sendBtn.disabled = true;
  sendBtn.textContent = "Sending…";
  batchList.innerHTML = "";
  sendTerminal.innerHTML = "";
  progressFill.style.width = "0%";
  const totalBatches = Math.ceil(lastEstimate.valid.length / BATCH_SIZE);
  progressLabel.textContent = `0 / ${totalBatches} batches`;

  try {
    await sendToAll({
      asset: currentAsset,
      recipients: lastEstimate.valid,
      amountPerWallet: amount,
      decimals: Number(mintDecimalsInput.value || 0),
      mintPubkey: lastEstimate.mintPubkey,
      terminal: sendTerminal,
      onProgress: ({ completed, total, result }) => {
        progressFill.style.width = `${(completed / total) * 100}%`;
        progressLabel.textContent = `${completed} / ${total} batches`;
        const row = document.createElement("div");
        row.className = "batch-row";
        if (result.status === "ok") {
          row.innerHTML = `<span class="batch-status-ok">Batch ${result.batchIndex + 1} · ${result.addresses.length} recipients ✓</span><a href="https://solscan.io/tx/${result.signature}" target="_blank" rel="noopener">${result.signature.slice(0, 10)}…</a>`;
        } else {
          row.innerHTML = `<span class="batch-status-err">Batch ${result.batchIndex + 1} failed</span><span class="batch-status-err">${result.error}</span>`;
        }
        batchList.appendChild(row);
      },
    });
    sendBtn.textContent = "Send to All Recipients";
  } catch (err) {
    alert(`Send failed: ${err.message || err}`);
    sendBtn.textContent = "Send to All Recipients";
  } finally {
    sendBtn.disabled = false;
  }
});
