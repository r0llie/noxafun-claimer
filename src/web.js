import { ethers } from "ethers";
import "./styles.css";

const CHAIN_ID = 4663n;
const CHAIN_ID_HEX = "0x1237";
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const DEFAULT_FEE_MANAGER = "0x9eFdC1A8e6E94f16A228e44f3025E1f346EE0417";
const POSITION_OWNER = "0x7F03effbd7ceB22A3f80Dd468f67eF27826acD85";
const CREATOR_FEE_BPS = 3500n;
const BPS = 10000n;
const COLLECT_ABI = ["function collect(address token) external"];
const NFPM_ABI = [
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256 amount0,uint256 amount1)"
];
const readProvider = new ethers.JsonRpcProvider(RPC_URL, Number(CHAIN_ID));

let state = {
  account: "",
  accountInput: "",
  managerInput: DEFAULT_FEE_MANAGER,
  provider: null,
  signer: null,
  tokens: [],
  filter: "all",
  query: "",
  busy: false,
  log: []
};

const app = document.querySelector("#app");

function shortAddress(address) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setLog(message) {
  const time = new Date().toLocaleTimeString();
  state.log = [`[${time}] ${message}`, ...state.log].slice(0, 80);
  render();
}

function setBusy(busy) {
  state.busy = busy;
  render();
}

function tokenInitials(token) {
  return escapeHtml((token.symbol || token.name || "?").slice(0, 4).toUpperCase());
}

function normalizeToken(token) {
  return {
    ...token,
    address: ethers.getAddress(token.address),
    selected: true,
    status: "idle",
    gas: "",
    grossWeth: "",
    creatorEth: "",
    txHash: "",
    error: ""
  };
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
  const tokens = (Array.isArray(walletIndex[accountKey]) ? walletIndex[accountKey] : [])
    .map(([address, block]) => {
      const info = metadata.get(String(address).toLowerCase());
      return {
        address,
        name: info?.[1] || "",
        symbol: info?.[2] || "",
        block: String(block),
        graduated: Boolean(info?.[4])
      };
    });

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

async function connectWallet() {
  if (!window.ethereum) {
    setLog("No injected wallet found. Open this in a browser with MetaMask, Rabby, or Brave Wallet.");
    return;
  }

  setBusy(true);
  try {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    await browserProvider.send("eth_requestAccounts", []);
    const network = await browserProvider.getNetwork();

    if (network.chainId !== CHAIN_ID) {
      await switchToRobinhood();
    }

    state.provider = new ethers.BrowserProvider(window.ethereum);
    state.signer = await state.provider.getSigner();
    state.account = await state.signer.getAddress();
    state.accountInput = state.account;
    setLog(`Connected ${state.account}`);
  } catch (error) {
    setLog(error.shortMessage || error.message);
  } finally {
    setBusy(false);
  }
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

async function loadTokens() {
  setBusy(true);
  try {
    const accountValue = state.accountInput || state.account;
    if (!accountValue) throw new Error("Connect a wallet or enter a creator account first.");
    const account = ethers.getAddress(accountValue);
    const tokens = await fetchCreatedTokens(account);
    state.tokens = tokens;
    setLog(`Loaded ${tokens.length} created tokens`);
  } catch (error) {
    setLog(error.shortMessage || error.message);
  } finally {
    setBusy(false);
  }
}

function getContract() {
  if (!state.signer) throw new Error("Connect wallet first.");
  const feeManager = ethers.getAddress(state.managerInput);
  return new ethers.Contract(feeManager, COLLECT_ABI, state.signer);
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
  const registryData = `0x3cf28b5a${addressArg(token.address)}`;
  const registryOutput = await readProvider.call({
    to: POSITION_OWNER,
    data: registryData
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

  const wethAmount = token0.toLowerCase() === "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
    ? amount0
    : amount1;
  const creatorAmount = (wethAmount * CREATOR_FEE_BPS) / BPS;
  return { grossWeth: wethAmount, creatorEth: creatorAmount };
}

async function simulateToken(token) {
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
    try {
      const amounts = await estimateCreatorEth(token);
      token.grossWeth = ethers.formatEther(amounts.grossWeth);
      token.creatorEth = ethers.formatEther(amounts.creatorEth);
    } catch (amountError) {
      token.creatorEth = "";
      setLog(`Amount unavailable ${token.symbol || token.address}: ${amountError.shortMessage || amountError.message}`);
    }
    token.status = "ok";
    token.gas = gas.toString();
    token.selected = true;
    setLog(`OK ${token.symbol || token.address}: gas ${token.gas}${token.creatorEth ? `, est ${token.creatorEth} ETH` : ""}`);
  } catch (error) {
    token.status = "bad";
    token.selected = false;
    token.error = error.shortMessage || error.reason || error.message;
    setLog(`Skip ${token.symbol || token.address}: ${token.error}`);
  }
}

async function simulateAll() {
  setBusy(true);
  try {
    for (const token of state.tokens) {
      await simulateToken(token);
    }
  } finally {
    setBusy(false);
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
    setLog(`Sent ${token.symbol || token.address}: ${tx.hash}`);
    const receipt = await tx.wait();
    token.status = receipt.status === 1 ? "claimed" : "bad";
    token.selected = false;
    setLog(`${receipt.status === 1 ? "Claimed" : "Failed"} ${token.symbol || token.address}`);
  } catch (error) {
    token.status = "bad";
    token.error = error.shortMessage || error.reason || error.message;
    setLog(`Claim failed ${token.symbol || token.address}: ${token.error}`);
  }

  render();
}

async function claimSelected() {
  const targets = state.tokens.filter((token) => token.selected && token.status === "ok");
  if (targets.length === 0) {
    setLog("No simulated OK tokens selected.");
    return;
  }

  setBusy(true);
  try {
    for (const token of targets) {
      await claimToken(token);
    }
  } finally {
    setBusy(false);
  }
}

function filteredTokens() {
  const query = state.query.trim().toLowerCase();
  return state.tokens.filter((token) => {
    const statusMatch =
      state.filter === "all" ||
      (state.filter === "selected" && token.selected) ||
      token.status === state.filter;
    const queryMatch =
      !query ||
      token.address.toLowerCase().includes(query) ||
      String(token.symbol || "").toLowerCase().includes(query) ||
      String(token.name || "").toLowerCase().includes(query);
    return statusMatch && queryMatch;
  });
}

function stats() {
  const ok = state.tokens.filter((token) => token.status === "ok").length;
  const bad = state.tokens.filter((token) => token.status === "bad").length;
  const selected = state.tokens.filter((token) => token.selected && token.status === "ok").length;
  const gas = state.tokens
    .filter((token) => token.status === "ok" && token.gas)
    .reduce((sum, token) => sum + BigInt(token.gas), 0n);
  const creatorWei = state.tokens
    .filter((token) => token.status === "ok" && token.creatorEth)
    .reduce((sum, token) => sum + ethers.parseEther(token.creatorEth), 0n);

  return {
    total: state.tokens.length,
    ok,
    bad,
    selected,
    gas: gas.toString(),
    creatorEth: ethers.formatEther(creatorWei)
  };
}

function renderStatus(token) {
  const labels = {
    idle: "not checked",
    pending: "checking",
    ok: "claimable",
    bad: "skip",
    claimed: "claimed"
  };
  const klass = token.status === "ok" || token.status === "claimed" ? "ok" : token.status === "bad" ? "bad" : token.status === "pending" ? "pending" : "";
  return `<span class="status ${klass}">${labels[token.status] || token.status}</span>`;
}

function renderRows() {
  const tokens = filteredTokens();
  if (tokens.length === 0) {
    return `<tr><td colspan="8" class="empty-state"><div class="empty-icon">◇</div><strong>Your tokens will appear here</strong><span>Connect a wallet and fetch created tokens to get started.</span></td></tr>`;
  }

  return tokens
    .map(
      (token) => `
        <tr>
          <td>
            <input type="checkbox" data-action="toggle" data-address="${token.address}" ${token.selected ? "checked" : ""} ${token.status !== "ok" ? "disabled" : ""} />
          </td>
          <td>
            <div class="token">
              <div class="avatar">${tokenInitials(token)}</div>
              <div>
                <strong>${escapeHtml(token.symbol || "TOKEN")}</strong>
                <span>${escapeHtml(token.name || "Unnamed")}</span>
              </div>
            </div>
          </td>
          <td class="mono">${shortAddress(token.address)}</td>
          <td>${renderStatus(token)}</td>
          <td class="mono">${token.creatorEth ? Number(token.creatorEth).toFixed(6) : "-"}</td>
          <td class="mono">${token.gas || "-"}</td>
          <td class="mono">${token.txHash ? `<a href="${EXPLORER}/tx/${token.txHash}" target="_blank" rel="noreferrer">${shortAddress(token.txHash)}</a>` : token.error ? escapeHtml(token.error.slice(0, 42)) : "-"}</td>
          <td>
            <div class="row-actions">
              <button data-action="simulate-one" data-address="${token.address}" ${state.busy ? "disabled" : ""}>Check</button>
              <button class="claim-one" data-action="claim-one" data-address="${token.address}" ${state.busy || token.status !== "ok" ? "disabled" : ""}>Claim</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function render() {
  const s = stats();
  app.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <div class="mark">NX</div>
          <div>
            <h1>Noxa Fun Claimer</h1>
            <p>${shortAddress(state.account)} · Robinhood Chain</p>
          </div>
        </div>
        <div class="actions">
          <button class="secondary" data-action="connect" ${state.busy ? "disabled" : ""}>Connect</button>
          <button class="secondary" data-action="load" ${state.busy ? "disabled" : ""}>Load Tokens</button>
          <button class="primary" data-action="simulate-all" ${state.busy || !state.tokens.length ? "disabled" : ""}>Check All</button>
          <button class="primary" data-action="claim-selected" ${state.busy || !s.selected ? "disabled" : ""}>Claim Selected</button>
        </div>
      </header>

      <div class="layout">
        <aside class="panel">
          <section class="section">
            <h2>Inputs</h2>
            <div class="field">
              <label for="accountInput">Creator account</label>
              <input id="accountInput" value="${escapeHtml(state.accountInput)}" placeholder="0x..." spellcheck="false" />
            </div>
            <div class="field">
              <label for="managerInput">Fee manager</label>
              <input id="managerInput" value="${escapeHtml(state.managerInput)}" spellcheck="false" />
            </div>
            <div class="stack">
              <button data-action="connect" ${state.busy ? "disabled" : ""}>Connect Wallet</button>
              <button data-action="load" ${state.busy ? "disabled" : ""}>Fetch Created Tokens</button>
            </div>
          </section>

          <section class="section">
            <h2>Run</h2>
            <div class="stats">
              <div class="stat"><span>Total</span><strong>${s.total}</strong></div>
              <div class="stat"><span>Claimable</span><strong>${s.ok}</strong></div>
              <div class="stat"><span>Skipped</span><strong>${s.bad}</strong></div>
              <div class="stat"><span>Selected</span><strong>${s.selected}</strong></div>
            </div>
          </section>

          <section class="section">
            <h2>Estimate</h2>
            <div class="stat"><span>Creator ETH</span><strong>${Number(s.creatorEth).toFixed(6)}</strong></div>
          </section>

          <section class="section">
            <h2>Gas</h2>
            <div class="stat"><span>Estimated callable gas</span><strong>${s.gas}</strong></div>
          </section>
        </aside>

        <main class="main">
          <div class="toolbar">
            <div class="filters">
              ${["all", "ok", "bad", "claimed", "selected"].map((filter) => `<button class="chip ${state.filter === filter ? "active" : ""}" data-filter="${filter}">${filter}</button>`).join("")}
            </div>
            <input class="search" id="searchInput" value="${escapeHtml(state.query)}" placeholder="Search token, symbol, address" />
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Token</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Est. ETH</th>
                  <th>Gas</th>
                  <th>Result</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${renderRows()}</tbody>
            </table>
          </div>

          <div class="log">${state.log.map(escapeHtml).join("\n") || "Ready."}</div>
        </main>
      </div>
    </div>
  `;
}

app.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  const action = target.dataset.action;
  const address = target.dataset.address;
  const token = address ? state.tokens.find((item) => item.address === address) : null;

  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
    render();
    return;
  }

  if (action === "connect") await connectWallet();
  if (action === "load") await loadTokens();
  if (action === "simulate-all") await simulateAll();
  if (action === "claim-selected") await claimSelected();
  if (action === "simulate-one" && token) await simulateToken(token);
  if (action === "claim-one" && token) await claimToken(token);
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.action !== "toggle") return;

  const token = state.tokens.find((item) => item.address === target.dataset.address);
  if (token) token.selected = target.checked;
  render();
});

app.addEventListener("input", (event) => {
  if (event.target.id === "searchInput") {
    state.query = event.target.value;
    document.querySelectorAll("tbody tr").forEach((row) => {
      if (!row.querySelector(".empty-state")) {
        row.hidden = Boolean(state.query) && !row.textContent.toLowerCase().includes(state.query.toLowerCase());
      }
    });
  }
  if (event.target.id === "accountInput") {
    state.accountInput = event.target.value;
  }
  if (event.target.id === "managerInput") {
    state.managerInput = event.target.value;
  }
});

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

render();
