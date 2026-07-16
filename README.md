# noxafunclaimer

Small Robinhood Chain fee-claim helper for Noxa Fun creator fees. It calls the
Noxa fee manager contract:

```solidity
collect(address token)
```

Robinhood Chain mainnet uses chain id `4663`, ETH for gas, and the public RPC
`https://rpc.mainnet.chain.robinhood.com`.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

## Web app

```powershell
npm run dev
```

Open `http://127.0.0.1:5173/`.

The web app uses your injected wallet for signing. It does not ask for a private
key. The local Vite server proxies Noxa's static catalog so token loading works
without CORS issues.

Edit `.env`:

```dotenv
PRIVATE_KEY=0x...
FEE_MANAGER=0x9eFdC1A8e6E94f16A228e44f3025E1f346EE0417
NOXA_ACCOUNT=0xYourCreatorWalletAddress
TOKEN_ADDRESSES=
DRY_RUN=true
```

Use a hot wallet with only enough ETH for gas. Do not paste a seed phrase; this
script only needs the private key for the address that sends the collect calls.

## List created tokens

This uses Noxa's `catalog/rh` wallet index and prints tokens created by the
account:

```powershell
npm run tokens -- 0xYourWalletAddress
```

If you do not want automatic API discovery, paste token addresses into
`TOKEN_ADDRESSES`.

## Dry-run

```powershell
npm run claim:dry
```

Dry-run checks `collect.staticCall(token)` and gas estimates without sending a
transaction.

## Send claims

```powershell
npm run claim:send
```

The script sends one transaction per token and waits for receipts.
