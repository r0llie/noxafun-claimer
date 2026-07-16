import "dotenv/config";
import { getRequiredEnv } from "./config.js";
import { getCreatedTokens } from "./noxa.js";

async function main() {
  const account = process.argv[2] || process.env.NOXA_ACCOUNT || getRequiredEnv("NOXA_ACCOUNT");
  const tokens = await getCreatedTokens(account);

  console.error(`Found ${tokens.length} created tokens for ${account}`);
  for (const token of tokens) {
    console.log(`${token.address} ${token.symbol || ""} ${token.name || ""}`.trim());
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
