import { useState } from 'react'
import { formatEther, formatUnits, parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { GASLESSSWAP_ADDRESS, TOKEN_LIST, gaslessSwapAbi } from '../constants'
import ConnectMenu from './ConnectMenu'

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <p className="text-[11px] text-sub">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ?? ''}`}>{value}</p>
    </div>
  )
}

function useVaultRead(functionName, args = [], enabled = true) {
  return useReadContract({
    address: GASLESSSWAP_ADDRESS,
    abi: gaslessSwapAbi,
    functionName,
    args,
    query: { enabled, refetchInterval: 5000 },
  }).data
}

function FeeList({ functionName, lp }) {
  // one hook call per token, fixed order — fine for a static token list
  const values = TOKEN_LIST.map((t) =>
    useVaultRead(functionName, lp ? [lp, t.address] : [t.address], lp !== null)
  )
  const parts = TOKEN_LIST.map((t, i) => {
    const v = values[i]
    if (v === undefined || v === 0n) return null
    return `${Number(formatUnits(v, t.decimals)).toLocaleString(undefined, { maximumFractionDigits: 5 })} ${t.symbol}`
  }).filter(Boolean)
  return parts.length ? parts.join(' · ') : '0'
}

export default function EarnSection() {
  const { address, isConnected } = useAccount()
  const [amount, setAmount] = useState('1')
  const [error, setError] = useState(null)

  const { writeContract, data: txHash, isPending, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const gasPool = useVaultRead('gasPool')
  const totalGas = useVaultRead('totalGasReimbursed')
  const myShares = useVaultRead('shares', [address], !!address)
  const myValue = useVaultRead('shareValue', [address], !!address)
  const myPending = TOKEN_LIST.map((t) =>
    useVaultRead('pendingFees', [address, t.address], !!address)
  )
  const hasPending = myPending.some((v) => v !== undefined && v > 0n)

  const act = (params) => {
    setError(null)
    reset()
    writeContract(params, { onError: (e) => setError(e.shortMessage ?? e.message) })
  }

  const deposit = () =>
    act({
      address: GASLESSSWAP_ADDRESS,
      abi: gaslessSwapAbi,
      functionName: 'depositGas',
      value: parseEther(amount || '0'),
    })

  const withdraw = () =>
    act({
      address: GASLESSSWAP_ADDRESS,
      abi: gaslessSwapAbi,
      functionName: 'withdrawGas',
      args: [myShares],
    })

  const claim = () =>
    act({
      address: GASLESSSWAP_ADDRESS,
      abi: gaslessSwapAbi,
      functionName: 'claimFees',
    })

  const busy = isPending || confirming
  const fmt = (v, dec = 4) => (v === undefined ? '…' : Number(formatEther(v)).toFixed(dec))

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Provide gas liquidity, earn swap fees</h2>
        <p className="mt-1 text-xs text-sub">
          Your MON pays the gas of gasless swappers. In exchange the vault collects{' '}
          <span className="text-fg">0.3% of every swap</span> (in the swapped token) — fees accrue
          to LPs pro rata, executors are reimbursed gas +10% from the pool.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Vault MON" value={`${fmt(gasPool, 3)}`} />
        <Stat label="Fees collected" value={<FeeList functionName="totalFeesCollected" lp={null} />} accent="text-green" />
        <Stat label="Gas reimbursed" value={`${fmt(totalGas)}`} />
      </div>

      {isConnected && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="My position" value={`${fmt(myValue, 4)} MON`} />
          <Stat
            label="My claimable fees"
            value={<FeeList functionName="pendingFees" lp={address} />}
            accent="text-green"
          />
        </div>
      )}

      {isConnected ? (
        <>
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="MON amount"
              className="w-full rounded-xl border border-line bg-bg px-3 text-sm font-semibold outline-none placeholder:text-sub"
            />
            <button
              onClick={deposit}
              disabled={busy || !amount || Number(amount) === 0}
              className="shrink-0 rounded-xl bg-purple px-4 py-2.5 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? '…' : 'Deposit MON'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={claim}
              disabled={busy || !hasPending}
              className="w-full rounded-xl border border-green/40 bg-green/10 py-2.5 text-sm font-medium text-green transition hover:bg-green/20 disabled:opacity-40"
            >
              Claim fees
            </button>
            <button
              onClick={withdraw}
              disabled={busy || !myShares}
              className="w-full rounded-xl border border-line bg-bg py-2.5 text-sm font-medium text-sub transition hover:text-fg disabled:opacity-40"
            >
              Withdraw all
            </button>
          </div>
        </>
      ) : (
        <ConnectMenu className="rounded-xl bg-purple py-3 text-sm font-medium text-bg transition hover:opacity-90 w-full" />
      )}

      {confirmed && (
        <p className="animate-slide-in text-center text-xs font-medium text-green">
          Transaction confirmed
        </p>
      )}
      {error && <p className="text-center text-xs text-red-400">{error}</p>}
    </section>
  )
}
