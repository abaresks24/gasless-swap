# ⚡ GaslessSwap — sign to swap, no gas ever

A gasless swap **protocol** on Monad testnet. Users sign two messages (zero
gas), anyone executes the swap on-chain, and an **LP-funded MON vault** pays
the gas. In exchange the vault collects a percentage of every swap — LPs earn
the spread between fees collected and gas paid.

Solves DeFi's #1 onboarding problem: *you need the gas token to buy the gas
token.*

## The three actors

```
  USER                    EXECUTOR                    LP (Provider)
  has USDC, 0 MON         any wallet with MON         deposits MON in the vault
  signs 2 messages   →    submits execute()      →    vault reimburses executor
  receives wETH           reimbursed gas +10%         gas in MON, collects 0.3%
  pays 0 gas              (profitable to relay)       of every swap (in tokens)
```

**LP economics, measured on-chain:** a 100 USDC swap costs the vault
~0.063 MON of gas reimbursement and earns it 0.30 USDC of fees. The 0.1%
minimum fee is enforced by the contract (`minRelayerFeeBps`).

## How a swap works

1. User signs an **EIP-2612 `permit`** — lets the contract pull their USDC (no approval tx)
2. User signs an **EIP-712 `SwapIntent`** — amount, slippage, fee, deadline, nonce
3. Anyone calls `execute(intent, permitSig, intentSig)` — one atomic tx:
   verifies signatures → pulls USDC → takes the LP fee on the input →
   swaps via **Uniswap V3** → sends output to the user → reimburses the
   executor's gas from the vault (gas + 10% premium)

## The LP vault (fully on-chain — `contracts/src/GaslessSwap.sol`)

- `depositGas()` — deposit MON, mint shares at the current share price
- `withdrawGas(shares)` — burn shares for a pro-rata slice of the MON pool (+ auto-claim fees)
- `claimFees()` — collect your share of swap fees (MasterChef-style `accFeePerShare` accounting, per fee token)
- Late LPs get **no claim on past fees**; two equal LPs split fees 50/50 (covered by tests)
- Executor reimbursement: `(measured gas + gasOverhead) × tx.gasprice × (1 + premium)`, paid in MON from the pool

## Deployed contracts (Monad testnet, chain 10143)

Swaps run through a **real Uniswap V3 deployment** (official bytecode from the
`@uniswap/*` npm packages — the pre-reset Uniswap testnet addresses no longer
have code, so the stack was redeployed):

| Contract | Address |
|---|---|
| **GaslessSwap (vault + intents)** | `0x2743dC959d8010473D3722416F79935817Aa613f` |
| USDC (test token, EIP-2612) | `0xa60545A050Ee596e02044553867917a718EE60df` |
| wETH (test token) | `0xF41e0c179910334430F27879269119E87EDc6CA3` |
| UniswapV3Factory | `0x140590c2b34835184a450853dc47fc782673ce70` |
| SwapRouter02 | `0x3d28251fc82ad86c9dd3e496d5560c66e5eb3f55` |
| QuoterV2 | `0xcca9846ac0269606cd0f33b7ffa397d9064acdd6` |
| NonfungiblePositionManager | `0xcfb921985158e2f4352f5d5eabdddc4516a01ac8` |
| USDC/wETH 0.3% pool | `0x767E3cb46c16658dEfAEdEEC3542cF4C6528B156` |

Pool liquidity: 1,000,000 USDC / 400 wETH full range (1 wETH ≈ 2,500 USDC).

## Verified on-chain (e2e, re-runnable)

`cd frontend && node scripts/e2e.mjs` — generates a brand-new wallet with
**0 MON** and proves, against the live testnet:

```
✅ user received wETH            (0.0397 wETH for 100 USDC, real pool math)
✅ user spent zero MON
✅ executor net positive          (+0.0017 MON per swap)
✅ vault collected 0.30 USDC fee
✅ vault paid exactly the reimbursement
```

## Repo layout

```
contracts/   Foundry — GaslessSwap.sol (intents + LP vault), tests vs REAL
             Uniswap V3 bytecode (official artifacts, no mock router)
frontend/    React + Vite + wagmi v2 + viem + Tailwind v4 — Swap + Provide tabs
```

## Run it

```bash
# Tests (15 tests, real Uniswap V3 factory/pool/router via official artifacts)
cd contracts && forge test -vv

# Deploy GaslessSwap (PRIVATE_KEY in contracts/.env; seeds the vault with 2 MON)
source .env && forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY

# Uniswap V3 stack + pool (only if redeploying from scratch)
cd ../frontend && node scripts/deploy-univ3.mjs && node scripts/seed-pool.mjs

# Frontend (fill frontend/.env from .env.example)
npm install && npm run dev

# On-chain end-to-end proof
node scripts/e2e.mjs
```

## Security properties

- **Replay protection**: sequential per-user nonce + intent hash marked used before external calls
- **Tamper-proof intents**: changing any signed field invalidates the signature
- **Slippage** enforced on-chain (`minAmountOut`), **fee bounds** enforced on-chain (0.1%–5%)
- **Permit front-run safe**: permit wrapped in try/catch, falls back to the existing allowance
- **Reentrancy**: `nonReentrant` on all state-changing entry points
- **Vault solvency**: execute reverts if the pool can't cover the gas reimbursement

## Monad-specific notes

- Monad charges the **gas limit**, not gas used — executors must set a tight
  explicit limit (the frontend uses 600k) to stay below the vault reimbursement
- Public RPC is limited to 15 req/s; back-to-back txs from one sender need
  explicit nonce management (see `scripts/seed-pool.mjs`)
