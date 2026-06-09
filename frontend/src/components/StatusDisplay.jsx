import { EXPLORER_URL } from '../constants'

const STEPS = {
  signing_permit: 'Sign the permit in your wallet — 1 of 2, no gas',
  signing_intent: 'Sign the swap intent — 2 of 2, no gas',
  relaying: 'Executing on-chain…',
}

export default function StatusDisplay({ status, result, error }) {
  if (status === 'idle') return null

  if (status === 'success') {
    return (
      <div className="animate-slide-in rounded-lg border border-line bg-bg p-3 text-sm">
        <p className="font-medium">Swapped. You received {result.amountOut} wETH.</p>
        <p className="mt-1 text-xs text-sub">
          Gas paid by you: 0 MON ·{' '}
          <a
            href={`${EXPLORER_URL}/tx/${result.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-fg"
          >
            transaction
          </a>{' '}
          submitted by the executor
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="animate-slide-in rounded-lg border border-red-900 bg-bg p-3 text-sm text-red-400">
        {error}
      </div>
    )
  }

  return (
    <div className="animate-slide-in rounded-lg border border-line bg-bg p-3 text-sm text-sub">
      {STEPS[status]}
    </div>
  )
}
