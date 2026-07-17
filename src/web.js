import { ethers } from "ethers";
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/bold";
import "./styles.css";

const CHAIN_ID = 4663n;
const CHAIN_ID_HEX = "0x1237";
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const DEFAULT_FEE_MANAGER = "0x9eFdC1A8e6E94f16A228e44f3025E1f346EE0417";
const POSITION_OWNER = "0x7F03effbd7ceB22A3f80Dd468f67eF27826acD85";
const CREATOR_FEE_BPS = 3500n;
const BPS = 10000n;
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const COLLECT_ABI = ["function collect(address token) external"];
const NFPM_ABI = [
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256 amount0,uint256 amount1)"
];

const readProvider = new ethers.JsonRpcProvider(RPC_URL, Number(CHAIN_ID));
const app = document.querySelector("#app");

const state = {
  account: "",
  accountInput: "",
  managerInput: DEFAULT_FEE_MANAGER,
  provider: null,
  signer: null,
  tokens: [],
  busy: false,
  phase: "idle",
  gasPriceWei: 0n,
  notice: null,
  log: [],
  expanded: { ready: true, claimed: false, attention: false },
  showAllReady: false,
  dialog: null,
  claimProgress: { current: 0, total: 0 }
};

function icon(name, weight = "regular") {
  const prefix = weight === "bold" ? "ph-bold" : "ph";
  return `<i class="${prefix} ph-${name}" aria-hidden="true"></i>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortAddress(address) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function tokenInitials(token) {
  return escapeHtml((token.symbol || token.name || "?").slice(0, 2).toUpperCase());
}

function formatEth(value, digits = 4) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function setLog(message) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  state.log = [`[${time}] ${message}`, ...state.log].slice(0, 80);
}

function setNotice(kind, title, message) {
  state.notice = { kind, title, message };
}

function normalizeToken(token) {
  return {
    ...token,
    address: ethers.getAddress(token.address),
    selected: false,
    status: "idle",
    gas: "",
    grossWeth: "",
    creatorEth: "",
    txHash: "",
    error: ""
  };
}

function isReadOnlyView() {
  return Boolean(
    state.account &&
      state.accountInput &&
      state.account.toLowerCase() !== state.accountInput.toLowerCase()
  );
}

async function fetchCreatedTokens(account) {
  const accountKey = account.toLowerCase();
  const shard = accountKey.slice(2, 3);
  const fetchCatalog = async (file) => {
    const response = await fetch(`/api/noxa/${file}`, { headers: { accept: "*/*" } });
    if (!response.ok) throw new Error(`Noxa catalog HTTP ${response.status}`);
    return response.json();
  };

  const [walletIndex, searchIndex] = await Promise.all([
    fetchCatalog(`wallets-${shard}.json`),
    fetchCatalog("search-index.json")
  ]);
  const metadata = new Map(
    (Array.isArray(searchIndex.tokens) ? searchIndex.tokens : []).map((token) => [
      String(token[0]).toLowerCase(),
      token
    ])
  );
  const tokens = (Array.isArray(walletIndex[accountKey]) ? walletIndex[accountKey] : []).map(
    ([address, block]) => {
      const info = metadata.get(String(address).toLowerCase());
      return {
        address,
        name: info?.[1] || "",
        symbol: info?.[2] || "",
        block: String(block),
        graduated: Boolean(info?.[4])
      };
    }
  );

  const seen = new Set();
  return tokens
    .filter((token) => token.address)
    .map(normalizeToken)
    .filter((token) => {
      const key = token.address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function switchToRobinhood() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }]
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER]
        }
      ]
    });
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setNotice(
      "error",
      "Wallet extension not found",
      "Open this page with MetaMask, Rabby, or Brave Wallet, then try again."
    );
    setLog("No injected wallet found");
    render();
    return;
  }

  state.busy = true;
  state.phase = "connecting";
  state.notice = null;
  render();

  try {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    await browserProvider.send("eth_requestAccounts", []);
    const network = await browserProvider.getNetwork();
    if (network.chainId !== CHAIN_ID) await switchToRobinhood();

    state.provider = new ethers.BrowserProvider(window.ethereum);
    state.signer = await state.provider.getSigner();
    state.account = await state.signer.getAddress();
    state.accountInput = state.account;
    setLog(`Connected ${state.account}`);
    await discoverAndSimulate(state.account);
  } catch (error) {
    state.phase = "idle";
    setNotice("error", "Connection stopped", error.shortMessage || error.message);
    setLog(error.shortMessage || error.message);
  } finally {
    state.busy = false;
    render();
  }
}

function getContract() {
  if (!state.signer) throw new Error("Connect your wallet first.");
  return new ethers.Contract(ethers.getAddress(state.managerInput), COLLECT_ABI, state.signer);
}

function addressArg(address) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [address]).slice(2);
}

function outputWord(output, index) {
  return `0x${output.slice(2 + index * 64, 2 + (index + 1) * 64)}`;
}

function outputAddress(output, index) {
  return ethers.getAddress(`0x${outputWord(output, index).slice(-40)}`);
}

async function estimateCreatorEth(token) {
  const registryOutput = await readProvider.call({
    to: POSITION_OWNER,
    data: `0x3cf28b5a${addressArg(token.address)}`
  });
  if (!registryOutput || registryOutput === "0x" || registryOutput.length < 2 + 5 * 64) {
    throw new Error("Position info unavailable");
  }

  const token0 = outputAddress(registryOutput, 2);
  const nfpmAddress = outputAddress(registryOutput, 3);
  const tokenId = BigInt(outputWord(registryOutput, 4));
  if (tokenId === 0n) throw new Error("No position token id");

  const nfpm = new ethers.Contract(nfpmAddress, NFPM_ABI, readProvider);
  const maxUint128 = (1n << 128n) - 1n;
  const [amount0, amount1] = await nfpm.collect.staticCall(
    {
      tokenId,
      recipient: POSITION_OWNER,
      amount0Max: maxUint128,
      amount1Max: maxUint128
    },
    { from: POSITION_OWNER }
  );
  const wethAmount = token0.toLowerCase() === WETH ? amount0 : amount1;
  return {
    grossWeth: wethAmount,
    creatorEth: (wethAmount * CREATOR_FEE_BPS) / BPS
  };
}

async function simulateToken(token, { quiet = false } = {}) {
  const contract = getContract();
  token.status = "pending";
  token.error = "";
  token.gas = "";
  token.grossWeth = "";
  token.creatorEth = "";
  render();

  try {
    await contract.collect.staticCall(token.address);
    const gas = await contract.collect.estimateGas(token.address);
    token.gas = gas.toString();
    try {
      const amounts = await estimateCreatorEth(token);
      token.grossWeth = ethers.formatEther(amounts.grossWeth);
      token.creatorEth = ethers.formatEther(amounts.creatorEth);
    } catch (amountError) {
      setLog(`Amount unavailable for ${token.symbol || shortAddress(token.address)}`);
    }
    token.status = "ok";
    token.selected = true;
    if (!quiet) setLog(`${token.symbol || shortAddress(token.address)} is ready to claim`);
  } catch (error) {
    token.status = "bad";
    token.selected = false;
    token.error = error.shortMessage || error.reason || error.message;
    if (!quiet) setLog(`${token.symbol || shortAddress(token.address)} needs attention`);
  }
  render();
}

async function refreshGasPrice() {
  try {
    const feeData = await readProvider.getFeeData();
    state.gasPriceWei = feeData.maxFeePerGas || feeData.gasPrice || 0n;
  } catch {
    state.gasPriceWei = 0n;
  }
}

async function simulateAll() {
  await refreshGasPrice();
  for (const token of state.tokens) await simulateToken(token, { quiet: true });
}

async function discoverAndSimulate(accountValue) {
  const account = ethers.getAddress(accountValue);
  state.busy = true;
  state.phase = "discovering";
  state.tokens = [];
  state.notice = null;
  state.showAllReady = false;
  render();

  try {
    state.tokens = await fetchCreatedTokens(account);
    setLog(`Found ${state.tokens.length} created tokens for ${shortAddress(account)}`);
    if (state.tokens.length === 0) {
      state.phase = "review";
      setNotice(
        "info",
        "No created tokens found",
        "This address has no tokens in the Noxa catalog yet. Try another creator address."
      );
      return;
    }
    await simulateAll();
    state.phase = "review";
    setLog("Discovery and safety simulation complete");
  } catch (error) {
    state.phase = "review";
    setNotice("error", "Discovery failed", error.shortMessage || error.message);
    setLog(error.shortMessage || error.message);
  } finally {
    state.busy = false;
    render();
  }
}

function withGasBuffer(gas) {
  return (BigInt(gas) * 120n) / 100n;
}

async function claimToken(token) {
  const contract = getContract();
  token.status = "pending";
  token.error = "";
  render();

  try {
    const gas = token.gas || (await contract.collect.estimateGas(token.address)).toString();
    const tx = await contract.collect(token.address, { gasLimit: withGasBuffer(gas) });
    token.txHash = tx.hash;
    setLog(`Submitted ${token.symbol || shortAddress(token.address)}: ${tx.hash}`);
    render();
    const receipt = await tx.wait();
    token.status = receipt.status === 1 ? "claimed" : "bad";
    token.selected = false;
    if (receipt.status !== 1) token.error = "Transaction failed on-chain";
    setLog(`${receipt.status === 1 ? "Claimed" : "Failed"} ${token.symbol || shortAddress(token.address)}`);
    return receipt.status === 1 ? "claimed" : "failed";
  } catch (error) {
    token.status = "bad";
    token.selected = false;
    token.error = error.shortMessage || error.reason || error.message;
    setLog(`Claim failed for ${token.symbol || shortAddress(token.address)}: ${token.error}`);
    return error.code === 4001 || error.code === "ACTION_REJECTED" ? "rejected" : "failed";
  } finally {
    render();
  }
}

async function claimSelected() {
  const targets = state.tokens.filter((token) => token.selected && token.status === "ok");
  if (!targets.length || isReadOnlyView()) return;

  state.dialog = null;
  state.phase = "claiming";
  state.busy = true;
  state.claimProgress = { current: 0, total: targets.length };
  state.notice = null;
  render();

  let claimed = 0;
  for (let index = 0; index < targets.length; index += 1) {
    state.claimProgress.current = index + 1;
    render();
    const result = await claimToken(targets[index]);
    if (result === "claimed") claimed += 1;
    if (result === "rejected") {
      setNotice(
        "info",
        "Claim queue paused",
        "The wallet confirmation was cancelled. Retry the affected token whenever you are ready."
      );
      break;
    }
  }

  state.busy = false;
  state.phase = claimed > 0 ? "complete" : "review";
  if (claimed > 0) {
    setNotice("success", "Claim queue complete", `${claimed} creator fee claim${claimed === 1 ? "" : "s"} confirmed on-chain.`);
  }
  render();
}

function stats() {
  const ready = state.tokens.filter((token) => token.status === "ok");
  const claimed = state.tokens.filter((token) => token.status === "claimed");
  const attention = state.tokens.filter((token) => token.status === "bad");
  const selected = ready.filter((token) => token.selected);
  const creatorWei = selected.reduce(
    (sum, token) => sum + (token.creatorEth ? ethers.parseEther(token.creatorEth) : 0n),
    0n
  );
  const gasUnits = selected.reduce((sum, token) => sum + (token.gas ? BigInt(token.gas) : 0n), 0n);
  const networkFeeWei = gasUnits * state.gasPriceWei;
  const netWei = creatorWei > networkFeeWei ? creatorWei - networkFeeWei : 0n;

  return {
    total: state.tokens.length,
    ready,
    claimed,
    attention,
    selected,
    creatorEth: ethers.formatEther(creatorWei),
    networkFeeEth: ethers.formatEther(networkFeeWei),
    netEth: ethers.formatEther(netWei)
  };
}

function renderNotice() {
  if (!state.notice) return "";
  const iconName = state.notice.kind === "error" ? "warning-circle" : state.notice.kind === "success" ? "check-circle" : "info";
  return `
    <div class="notice notice-${state.notice.kind}" role="status" aria-live="polite">
      ${icon(iconName, "bold")}
      <div><strong>${escapeHtml(state.notice.title)}</strong><span>${escapeHtml(state.notice.message)}</span></div>
      <button class="icon-button" data-action="dismiss-notice" aria-label="Dismiss message">${icon("x")}</button>
    </div>`;
}

function renderTokenRow(token) {
  const isReady = token.status === "ok";
  const isPending = token.status === "pending";
  const amount = token.creatorEth ? `${formatEth(token.creatorEth, 4)} ETH` : "Amount unavailable";
  return `
    <div class="token-row ${isPending ? "is-pending" : ""}">
      <label class="checkbox-wrap">
        <input
          type="checkbox"
          data-action="toggle-token"
          data-address="${token.address}"
          aria-label="Select ${escapeHtml(token.symbol || token.name || shortAddress(token.address))}"
          ${token.selected ? "checked" : ""}
          ${!isReady || state.busy ? "disabled" : ""}
        />
        <span class="checkbox-ui">${icon("check", "bold")}</span>
      </label>
      <div class="token-monogram" aria-hidden="true">${tokenInitials(token)}</div>
      <div class="token-identity">
        <strong>${escapeHtml(token.name || token.symbol || "Unnamed token")}</strong>
        <span>${escapeHtml(token.symbol || "TOKEN")} / ${shortAddress(token.address)}</span>
      </div>
      <div class="token-value">
        <strong>${amount}</strong>
        <span>${isReady ? "Ready to claim" : token.status === "claimed" ? "Claimed" : isPending ? "Checking..." : "Needs attention"}</span>
      </div>
      ${
        token.status === "bad"
          ? `<button class="row-button" data-action="retry-token" data-address="${token.address}" ${state.busy ? "disabled" : ""}>${icon("arrow-clockwise")} Retry</button>`
          : token.txHash
            ? `<a class="row-button" href="${EXPLORER}/tx/${token.txHash}" target="_blank" rel="noreferrer">${icon("arrow-square-out")} Receipt</a>`
            : `<span class="row-chevron">${icon("caret-right")}</span>`
      }
    </div>`;
}

function renderGroup(key, title, tokens, tone, defaultIcon) {
  const open = state.expanded[key];
  const visibleTokens = key === "ready" && !state.showAllReady ? tokens.slice(0, 6) : tokens;
  return `
    <section class="token-group ${open ? "is-open" : ""}">
      <button class="group-head" data-action="toggle-group" data-group="${key}" aria-expanded="${open}">
        <span class="group-status ${tone}">${icon(defaultIcon, "bold")}</span>
        <strong>${title}</strong>
        <span class="group-count">${tokens.length}</span>
        ${icon(open ? "caret-up" : "caret-down")}
      </button>
      ${
        open
          ? `<div class="group-body">
              ${tokens.length ? visibleTokens.map(renderTokenRow).join("") : `<div class="group-empty">Nothing here.</div>`}
              ${
                key === "ready" && tokens.length > 6
                  ? `<button class="show-more" data-action="toggle-ready-limit">${state.showAllReady ? "Show fewer" : `Show ${tokens.length - 6} more`} ${icon(state.showAllReady ? "caret-up" : "caret-down")}</button>`
                  : ""
              }
            </div>`
          : ""
      }
    </section>`;
}

function renderReviewRail(s) {
  const confirmations = s.selected.length;
  const minutes = confirmations ? Math.max(1, Math.ceil((confirmations * 15) / 60)) : 0;
  const readOnly = isReadOnlyView();
  const progressPercent = state.claimProgress.total
    ? Math.round((state.claimProgress.current / state.claimProgress.total) * 100)
    : 0;
  const buttonLabel = state.phase === "claiming" ? "Claim queue running" : state.phase === "complete" ? "Claim more fees" : "Start claim queue";

  return `
    <aside class="review-rail" aria-label="Claim review">
      <div class="review-heading">
        ${icon("file-text", "bold")}
        <div><h2>Claim review</h2><p>Review your secure claim queue.</p></div>
      </div>

      <div class="amount-stack">
        <div><span>Total claimable</span><strong>${formatEth(s.creatorEth)} ETH</strong></div>
        <div><span>Estimated network fee</span><strong>${state.gasPriceWei ? `${formatEth(s.networkFeeEth, 5)} ETH` : "Calculating"}</strong></div>
        <div class="net-amount"><span>Net amount</span><strong>${formatEth(s.netEth)} ETH</strong></div>
      </div>

      <dl class="queue-facts">
        <div><dt>${icon("stack")} Selected tokens</dt><dd>${confirmations} of ${s.ready.length}</dd></div>
        <div><dt>${icon("shield-check")} Wallet confirmations</dt><dd>${confirmations}</dd></div>
        <div><dt>${icon("clock")} Estimated time</dt><dd>${minutes ? `${minutes}-${minutes + 1} min` : "-"}</dd></div>
      </dl>

      ${
        state.phase === "claiming"
          ? `<div class="queue-progress" aria-live="polite">
              <div><span>Claim ${state.claimProgress.current} of ${state.claimProgress.total}</span><strong>${progressPercent}%</strong></div>
              <div class="progress-track"><span style="width:${progressPercent}%"></span></div>
              <p>Keep your wallet open. Each claim needs a separate confirmation.</p>
            </div>`
          : `<div class="safety-note">${icon("shield-check", "bold")}<p>Every claim is simulated first. Your keys always stay in your wallet.</p></div>`
      }

      ${
        readOnly
          ? `<div class="readonly-note">${icon("eye")} Read-only view. Return to your connected wallet to claim.</div>`
          : ""
      }

      <button class="claim-button" data-action="open-confirm" ${state.busy || !confirmations || readOnly ? "disabled" : ""}>
        <span>${icon(state.phase === "claiming" ? "spinner-gap" : "play", "bold")}</span>
        <strong>${buttonLabel}<small>${confirmations} wallet confirmation${confirmations === 1 ? "" : "s"}</small></strong>
      </button>

      <div class="trust-row">
        <span>${icon("check-circle")} Simulated</span>
        <span>${icon("lock-key")} Non-custodial</span>
        <span>${icon("list-checks")} Resumable</span>
      </div>

      <button class="advanced-link" data-action="open-advanced">${icon("sliders-horizontal")} Advanced</button>
    </aside>`;
}

function renderWorkspace() {
  const s = stats();
  if (state.phase === "discovering" || state.phase === "connecting") {
    const checked = state.tokens.filter((token) => ["ok", "bad"].includes(token.status)).length;
    return `
      <main class="loading-state" aria-live="polite">
        <div class="loading-icon">${icon(state.phase === "connecting" ? "wallet" : "magnifying-glass", "bold")}</div>
        <p class="eyebrow">${state.phase === "connecting" ? "Wallet connection" : "Automatic discovery"}</p>
        <h2>${state.phase === "connecting" ? "Connecting securely..." : "Finding and checking your tokens..."}</h2>
        <p>${state.tokens.length ? `${checked} of ${state.tokens.length} tokens checked` : "This usually takes less than a minute."}</p>
        <div class="scan-line"><span></span></div>
      </main>`;
  }

  if (!state.tokens.length) {
    return `
      <main class="empty-result">
        <div class="loading-icon">${icon("magnifying-glass", "bold")}</div>
        <p class="eyebrow">Discovery complete</p>
        <h2>No created tokens found</h2>
        <p>We checked ${escapeHtml(shortAddress(state.accountInput))}, but it has no tokens in the Noxa catalog.</p>
        <div class="empty-actions">
          <button class="primary-button" data-action="open-creator">${icon("arrows-left-right")} View another creator</button>
          <button class="text-button" data-action="use-connected">Use connected wallet</button>
        </div>
      </main>`;
  }

  return `
    <main class="workspace">
      <section class="claim-list">
        <header class="workspace-head">
          <div>
            <p class="eyebrow">${isReadOnlyView() ? "Creator preview" : "Discovery complete"}</p>
            <h1>${s.ready.length} of ${s.total} tokens ready</h1>
            <p>Review the results below. Eligible claims are already selected.</p>
          </div>
          <button class="secondary-button" data-action="open-creator">${icon("arrows-left-right")} View another creator</button>
        </header>

        ${renderNotice()}

        <div class="select-bar">
          <label class="checkbox-wrap">
            <input type="checkbox" data-action="toggle-all" aria-label="Select all ready tokens" ${s.ready.length && s.selected.length === s.ready.length ? "checked" : ""} ${state.busy || !s.ready.length ? "disabled" : ""} />
            <span class="checkbox-ui">${icon("check", "bold")}</span>
          </label>
          <span>Select all claimable tokens</span>
          <strong>${s.selected.length} selected</strong>
        </div>

        <div class="groups">
          ${renderGroup("ready", "Ready to claim", s.ready, "success", "check")}
          ${renderGroup("claimed", "Already claimed", s.claimed, "success-muted", "check-circle")}
          ${renderGroup("attention", "Needs attention", s.attention, "warning", "warning")}
        </div>

        <footer class="simulation-foot">${icon("shield-check")} We simulate every claim and only include callable tokens.</footer>
      </section>
      ${renderReviewRail(s)}
    </main>`;
}

function renderDisconnected() {
  return `
    <main class="onboarding">
      <div class="onboarding-icon">${icon("wallet", "bold")}</div>
      <p class="eyebrow">Creator fee recovery</p>
      <h1>Claim every eligible creator fee, without the busywork.</h1>
      <p>Connect your wallet once. We'll discover your tokens, simulate every claim, and build a safe queue automatically.</p>
      ${renderNotice()}
      <div class="onboarding-actions">
        <button class="primary-button large" data-action="connect" ${state.busy ? "disabled" : ""}>${icon("wallet", "bold")} Connect wallet</button>
        <button class="text-button" data-action="open-creator">${icon("eye")} Preview another creator</button>
      </div>
      <div class="onboarding-trust">
        <span>${icon("shield-check")} Simulated before signing</span>
        <span>${icon("key")} Keys stay in your wallet</span>
        <span>${icon("list-checks")} Clear confirmation count</span>
      </div>
    </main>`;
}

function renderDialog() {
  if (!state.dialog) return "";
  if (state.dialog === "creator") {
    return `
      <div class="modal-backdrop" data-action="close-dialog">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="creator-title" data-modal-panel>
          <button class="modal-close" data-action="close-dialog" aria-label="Close">${icon("x")}</button>
          <p class="eyebrow">Read-only lookup</p>
          <h2 id="creator-title">View another creator</h2>
          <p>Enter a creator address to discover its tokens. Claims stay disabled unless it matches your connected wallet.</p>
          <label for="creatorInput">Creator address</label>
          <input id="creatorInput" placeholder="0x..." value="${escapeHtml(state.accountInput)}" spellcheck="false" autocomplete="off" />
          <div class="modal-actions">
            <button class="text-button" data-action="close-dialog">Cancel</button>
            <button class="primary-button" data-action="load-creator">${icon("magnifying-glass")} Discover tokens</button>
          </div>
        </section>
      </div>`;
  }

  if (state.dialog === "advanced") {
    return `
      <div class="modal-backdrop" data-action="close-dialog">
        <section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="advanced-title" data-modal-panel>
          <button class="modal-close" data-action="close-dialog" aria-label="Close">${icon("x")}</button>
          <p class="eyebrow">For troubleshooting</p>
          <h2 id="advanced-title">Advanced settings</h2>
          <label for="managerInput">Fee manager contract</label>
          <div class="input-with-action"><input id="managerInput" value="${escapeHtml(state.managerInput)}" spellcheck="false" /><button data-action="save-manager">Save</button></div>
          <details class="activity-log">
            <summary>Activity log <span>${state.log.length} events</span></summary>
            <pre>${state.log.map(escapeHtml).join("\n") || "No activity yet."}</pre>
          </details>
        </section>
      </div>`;
  }

  const s = stats();
  return `
    <div class="modal-backdrop" data-action="close-dialog">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" data-modal-panel>
        <button class="modal-close" data-action="close-dialog" aria-label="Close">${icon("x")}</button>
        <div class="confirm-icon">${icon("shield-check", "bold")}</div>
        <p class="eyebrow">Final review</p>
        <h2 id="confirm-title">Start ${s.selected.length} claims?</h2>
        <p>Your wallet will ask for ${s.selected.length} separate confirmation${s.selected.length === 1 ? "" : "s"}. You can stop or retry failed items at any time.</p>
        <div class="confirm-summary"><span>Net estimate</span><strong>${formatEth(s.netEth)} ETH</strong></div>
        <div class="modal-actions">
          <button class="text-button" data-action="close-dialog">Go back</button>
          <button class="primary-button" data-action="confirm-claim">${icon("play", "bold")} Start claim queue</button>
        </div>
      </section>
    </div>`;
}

function render() {
  app.innerHTML = `
    ${state.busy ? `<div class="busy-bar" aria-hidden="true"></div>` : ""}
    <div class="app-shell" ${state.dialog ? `inert aria-hidden="true"` : ""}>
      <header class="topbar">
        <a class="brand" href="#" aria-label="Noxa Fun Claimer home">
          <span class="brand-mark">NX</span>
          <span><strong>Noxa Claimer</strong><small>Creator fee console</small></span>
        </a>
        <div class="wallet-cluster">
          <button class="wallet-control" data-action="connect" ${state.busy ? "disabled" : ""}>
            ${icon("wallet")}
            <span>${state.account ? shortAddress(state.account) : "Connect wallet"}</span>
            ${state.account ? icon("caret-down") : ""}
          </button>
          <div class="network-control">${icon("link")}<span>Robinhood Chain</span><b></b><small>${state.account ? "Connected" : "Ready"}</small></div>
        </div>
      </header>
      ${state.account ? renderWorkspace() : renderDisconnected()}
    </div>
    ${renderDialog()}
  `;
}

app.addEventListener("click", async (event) => {
  const control = event.target.closest("button, a, [data-action]");
  if (!control) return;
  if (control.classList.contains("modal-backdrop") && event.target.closest("[data-modal-panel]")) return;
  const action = control.dataset.action;
  const address = control.dataset.address;

  if (action === "connect") await connectWallet();
  if (action === "dismiss-notice") {
    state.notice = null;
    render();
  }
  if (action === "open-creator") {
    state.dialog = "creator";
    render();
    requestAnimationFrame(() => document.querySelector("#creatorInput")?.focus());
  }
  if (action === "open-advanced") {
    state.dialog = "advanced";
    render();
    requestAnimationFrame(() => document.querySelector("#managerInput")?.focus());
  }
  if (action === "open-confirm") {
    state.dialog = "confirm";
    render();
    requestAnimationFrame(() => document.querySelector('[data-action="confirm-claim"]')?.focus());
  }
  if (action === "close-dialog") {
    state.dialog = null;
    render();
    requestAnimationFrame(() => document.querySelector('[data-action="open-confirm"], [data-action="open-creator"]')?.focus());
  }
  if (action === "load-creator") {
    const input = document.querySelector("#creatorInput");
    try {
      const addressValue = ethers.getAddress(input?.value.trim() || "");
      if (!state.signer) {
        state.dialog = null;
        setNotice("info", "Connect before previewing", "A wallet connection is required to safely simulate claimability.");
        render();
        return;
      }
      state.accountInput = addressValue;
      state.dialog = null;
      await discoverAndSimulate(addressValue);
    } catch {
      input?.setAttribute("aria-invalid", "true");
      input?.focus();
    }
  }
  if (action === "use-connected" && state.account) {
    state.accountInput = state.account;
    await discoverAndSimulate(state.account);
  }
  if (action === "save-manager") {
    const input = document.querySelector("#managerInput");
    try {
      state.managerInput = ethers.getAddress(input?.value.trim() || "");
      state.dialog = null;
      setNotice("success", "Contract updated", "Run discovery again to simulate against the new fee manager.");
      render();
    } catch {
      input?.setAttribute("aria-invalid", "true");
      input?.focus();
    }
  }
  if (action === "toggle-group") {
    const group = control.dataset.group;
    state.expanded[group] = !state.expanded[group];
    render();
  }
  if (action === "toggle-ready-limit") {
    state.showAllReady = !state.showAllReady;
    render();
  }
  if (action === "retry-token") {
    const token = state.tokens.find((item) => item.address === address);
    if (token) {
      state.busy = true;
      render();
      await simulateToken(token);
      state.busy = false;
      render();
    }
  }
  if (action === "confirm-claim") await claimSelected();
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.action === "toggle-token") {
    const token = state.tokens.find((item) => item.address === target.dataset.address);
    if (token) token.selected = target.checked;
    render();
  }
  if (target.dataset.action === "toggle-all") {
    const checked = target.checked;
    state.tokens.forEach((token) => {
      if (token.status === "ok") token.selected = checked;
    });
    render();
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.dialog) {
    state.dialog = null;
    render();
  }
  if (event.key === "Enter" && state.dialog === "creator" && event.target.id === "creatorInput") {
    document.querySelector('[data-action="load-creator"]')?.click();
  }
});

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "review") {
  const previewNames = [
    ["NovaByte", "NOVA"],
    ["MemeWave", "WAVE"],
    ["Purrfect Fun", "PURR"],
    ["RocketPop", "RPOP"],
    ["Zappy", "ZAP"],
    ["Orbit Club", "ORBT"],
    ["Night Shift", "NSFT"],
    ["Soft Signal", "SGNL"],
    ["Rare Form", "RARE"],
    ["Local Loop", "LOOP"],
    ["Field Note", "NOTE"],
    ["After Dark", "DARK"],
    ["Old Guard", "OG"],
    ["Side Quest", "SIDE"],
    ["First Run", "RUN"],
    ["Mint Condition", "MINT"],
    ["Late Entry", "LATE"],
    ["Open Issue", "OPEN"]
  ];
  state.account = "0x9eFdC1A8e6E94f16A228e44f3025E1f346EE0417";
  state.accountInput = state.account;
  state.phase = "review";
  state.gasPriceWei = 1_000_000_000n;
  state.tokens = previewNames.map(([name, symbol], index) => ({
    address: ethers.getAddress(`0x${String(index + 1).padStart(40, "0")}`),
    name,
    symbol,
    selected: index < 12,
    status: index < 12 ? "ok" : index < 16 ? "claimed" : "bad",
    gas: index < 12 ? String(122000 + index * 1300) : "",
    grossWeth: "",
    creatorEth: index < 12 ? (0.1842 - index * 0.0087).toFixed(4) : "",
    txHash: index >= 12 && index < 16 ? `0x${"a".repeat(63)}${index.toString(16)}` : "",
    error: index >= 16 ? "Simulation reverted" : ""
  }));
}

render();
