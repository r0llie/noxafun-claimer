import { ethers } from "ethers";
import { DEFAULT_NOXA_API, uniqueAddresses } from "./config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        referer: "https://fun.noxa.eth.link/",
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

export async function getCreatedTokens(account, options = {}) {
  const checksumAccount = ethers.getAddress(account);
  const baseUrl = options.baseUrl || process.env.NOXA_API || DEFAULT_NOXA_API;
  const accountKey = checksumAccount.toLowerCase();
  const shard = accountKey.slice(2, 3);
  const [walletIndex, searchIndex] = await Promise.all([
    fetchJson(`${baseUrl}/wallets-${shard}.json`),
    fetchJson(`${baseUrl}/search-index.json`)
  ]);

  const walletTokens = Array.isArray(walletIndex[accountKey])
    ? walletIndex[accountKey]
    : [];
  const metadata = new Map(
    (Array.isArray(searchIndex.tokens) ? searchIndex.tokens : []).map((token) => [
      String(token[0]).toLowerCase(),
      token
    ])
  );
  const tokens = walletTokens.map(([address, block]) => {
    const info = metadata.get(String(address).toLowerCase());
    return {
      address,
      name: info?.[1] || "",
      symbol: info?.[2] || "",
      block: String(block),
      graduated: Boolean(info?.[4])
    };
  });

  const byAddress = new Map();
  for (const token of tokens) {
    if (!token.address) continue;
    const address = ethers.getAddress(token.address);
    byAddress.set(address.toLowerCase(), {
      ...token,
      address
    });
  }

  return uniqueAddresses([...byAddress.values()].map((token) => token.address))
    .map((address) => byAddress.get(address.toLowerCase()));
}
