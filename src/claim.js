import { ethers } from "ethers";
import {
  DEFAULT_FEE_MANAGER,
  getRequiredEnv,
  parseAddressList,
  parseBool,
  uniqueAddresses
} from "./config.js";
import { getCreatedTokens } from "./noxa.js";

const COLLECT_ABI = ["function collect(address to) external"];

function usage() {
  console.log(`
Usage:
  npm run claim:dry             # simulates only
  npm run claim:send            # sends real transactions
  node src/claim.js --help      # shows this help

Env:
  PRIVATE_KEY       signer private key
  RPC_URL           Robinhood Chain RPC
  FEE_MANAGER       Noxa collect contract
  NOXA_ACCOUNT      account whose created tokens should be fetched
  TOKEN_ADDRESSES   optional comma/newline separated token addresses
`);
}

function getDryRunFlag() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    usage();
    process.exit(0);
  }
  if (args.has("--send")) return false;
  if (args.has("--dry-run")) return true;
  return parseBool(process.env.DRY_RUN, true);
}

function withGasBuffer(gasEstimate) {
  return (gasEstimate * 120n) / 100n;
}

async function getTokenTargets() {
  const manualTokens = uniqueAddresses(parseAddressList(process.env.TOKEN_ADDRESSES));
  if (manualTokens.length > 0) {
    return manualTokens.map((address) => ({ address }));
  }

  const account = process.env.NOXA_ACCOUNT?.trim();
  if (!account) {
    throw new Error("Set TOKEN_ADDRESSES or NOXA_ACCOUNT in .env.");
  }

  return getCreatedTokens(account);
}

async function main() {
  const dryRun = getDryRunFlag();
  const rpcUrl = process.env.RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com";
  const expectedChainId = BigInt(process.env.CHAIN_ID?.trim() || "4663");
  const privateKey = getRequiredEnv("PRIVATE_KEY");
  const feeManager = ethers.getAddress(process.env.FEE_MANAGER?.trim() || DEFAULT_FEE_MANAGER);
  const tokenTargets = await getTokenTargets();

  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(expectedChainId));
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) {
    throw new Error(`RPC chain id is ${network.chainId}, expected ${expectedChainId}.`);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(feeManager, COLLECT_ABI, wallet);

  console.log(`Network: ${network.name || "Robinhood Chain"} (${network.chainId})`);
  console.log(`Signer:  ${await wallet.getAddress()}`);
  console.log(`Manager: ${feeManager}`);
  console.log(`Tokens:  ${tokenTargets.length}`);
  console.log(`Mode:    ${dryRun ? "dry-run" : "send"}`);
  console.log("");

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let estimatedGasTotal = 0n;

  for (const token of tokenTargets) {
    const tokenAddress = ethers.getAddress(token.address);
    const label = [token.symbol, token.name].filter(Boolean).join(" / ");
    console.log(`== ${tokenAddress}${label ? ` (${label})` : ""}`);

    try {
      await contract.collect.staticCall(tokenAddress);
      const gasEstimate = await contract.collect.estimateGas(tokenAddress);
      estimatedGasTotal += gasEstimate;
      console.log(`callStatic: ok`);
      console.log(`gas:        ${gasEstimate.toString()}`);

      if (dryRun) {
        skipped += 1;
        console.log("tx:         skipped (dry-run)");
      } else {
        const tx = await contract.collect(tokenAddress, {
          gasLimit: withGasBuffer(gasEstimate)
        });
        console.log(`tx:         ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`status:     ${receipt.status === 1 ? "success" : "failed"}`);
        ok += receipt.status === 1 ? 1 : 0;
        failed += receipt.status === 1 ? 0 : 1;
      }
    } catch (error) {
      failed += 1;
      console.log(`error:      ${error.shortMessage || error.reason || error.message}`);
    }

    console.log("");
  }

  console.log(`Estimated gas for callable tokens: ${estimatedGasTotal.toString()}`);
  console.log(`Done. successful=${ok} dryRunOk=${skipped} failed=${failed}`);
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
