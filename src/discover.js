import { ethers } from "ethers";
import {
  COLLECT_SELECTOR,
  DEFAULT_EXPLORER_API,
  uniqueAddresses
} from "./config.js";

function usage() {
  console.log(`
Usage:
  npm run discover -- 0xYourWallet

This scans the Blockscout transactions endpoint and prints contracts that the
wallet has called with collect(address), selector ${COLLECT_SELECTOR}.
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "noxafunclaimer/0.1"
      }
    });

    if (response.ok) {
      return response.json();
    }

    lastError = new Error(`HTTP ${response.status} from ${url}`);
    if (response.status < 500 || attempt === 3) break;
    await sleep(750 * attempt);
  }

  throw lastError;
}

function nextPageParams(payload) {
  const params = payload.next_page_params;
  if (!params || Object.keys(params).length === 0) return null;
  return new URLSearchParams(params).toString();
}

function txToAddress(tx) {
  const value = tx.to?.hash || tx.to_address_hash || tx.to_address || tx.to;
  if (!value) return null;

  try {
    return ethers.getAddress(value);
  } catch {
    return null;
  }
}

function txInput(tx) {
  return tx.raw_input || tx.input || "";
}

async function main() {
  const walletArg = process.argv[2];
  if (!walletArg || ["--help", "-h"].includes(walletArg)) {
    usage();
    process.exit(walletArg ? 0 : 1);
  }

  const wallet = ethers.getAddress(walletArg);
  const explorerApi = process.env.EXPLORER_API?.trim() || DEFAULT_EXPLORER_API;
  const maxPages = Number(process.env.DISCOVER_MAX_PAGES || "10");
  const found = [];

  let url = `${explorerApi}/addresses/${wallet}/transactions?filter=from`;

  for (let page = 1; page <= maxPages && url; page += 1) {
    console.error(`Scanning page ${page}: ${url}`);
    let payload;

    try {
      payload = await fetchJson(url);
    } catch (error) {
      console.error(`Explorer stopped on page ${page}: ${error.message}`);
      break;
    }

    const items = Array.isArray(payload.items) ? payload.items : [];

    for (const tx of items) {
      const input = txInput(tx).toLowerCase();
      const method = String(tx.method || tx.method_name || "").toLowerCase();

      if (input.startsWith(COLLECT_SELECTOR) || method === "collect") {
        const address = txToAddress(tx);
        if (address) found.push(address);
      }
    }

    const next = nextPageParams(payload);
    url = next ? `${explorerApi}/addresses/${wallet}/transactions?${next}` : null;
  }

  const addresses = uniqueAddresses(found);
  if (addresses.length === 0) {
    console.log("No collect(address) contracts found in the scanned pages.");
    return;
  }

  console.log(addresses.join(","));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
