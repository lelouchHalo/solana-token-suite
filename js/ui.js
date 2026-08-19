// ui.js — small DOM helpers shared by both tabs.

export function log(terminalEl, message, kind = "") {
  const line = document.createElement("span");
  line.className = "log-line" + (kind ? ` log-${kind}` : "");
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  line.textContent = `[${ts}] ${message}`;
  terminalEl.appendChild(line);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

export function logLink(terminalEl, label, url) {
  const wrap = document.createElement("span");
  wrap.className = "log-line";
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  wrap.textContent = `[${ts}] ${label} `;
  const a = document.createElement("a");
  a.className = "log-link";
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = url;
  wrap.appendChild(a);
  terminalEl.appendChild(wrap);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

export function setStep(railEl, stepKey, status) {
  // status: "pending" | "active" | "done" | "error"
  const li = railEl.querySelector(`[data-step="${stepKey}"]`);
  if (!li) return;
  li.classList.remove("active", "done", "error");
  const statusEl = li.querySelector(".step-status");
  if (status === "active") {
    li.classList.add("active");
    statusEl.textContent = "in progress…";
  } else if (status === "done") {
    li.classList.add("done");
    statusEl.textContent = "done";
  } else if (status === "error") {
    li.classList.add("error");
    statusEl.textContent = "failed";
  } else {
    statusEl.textContent = "—";
  }
}

export function solscanTx(sig, cluster = "") {
  return `https://solscan.io/tx/${sig}${cluster}`;
}

export function solscanAddr(addr, cluster = "") {
  return `https://solscan.io/account/${addr}${cluster}`;
}

export function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
