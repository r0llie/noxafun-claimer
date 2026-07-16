import "dotenv/config";
import { ethers } from "ethers";

export const COLLECT_SELECTOR = "0x06ec16f8";
export const DEFAULT_EXPLORER_API = "https://robinhoodchain.blockscout.com/api/v2";
export const DEFAULT_NOXA_API = "https://fun.noxa.eth.link/catalog/rh";
export const DEFAULT_FEE_MANAGER = "0x9eFdC1A8e6E94f16A228e44f3025E1f346EE0417";

export function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and set it first.`);
  }
  return value;
}

export function parseBool(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

export function parseAddressList(value) {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ethers.getAddress(entry));
}

export function uniqueAddresses(addresses) {
  const seen = new Set();
  const result = [];

  for (const address of addresses) {
    const checksum = ethers.getAddress(address);
    const key = checksum.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(checksum);
    }
  }

  return result;
}
