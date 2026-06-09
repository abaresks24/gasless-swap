import { useState } from 'react'
import { useConnect } from 'wagmi'

/** Connect button that lists every EIP-6963 discovered wallet (Rabby, MetaMask, Phantom, ...). */
export default function ConnectMenu({ className }) {
  const { connect, connectors } = useConnect()
  const [open, setOpen] = useState(false)

  if (connectors.length === 0) {
    return <span className="text-xs text-sub">No wallet detected</span>
  }

  if (connectors.length === 1) {
    return (
      <button
        onClick={() => connect({ connector: connectors[0] })}
        className={className ?? 'rounded-md bg-fg px-3.5 py-1.5 text-xs font-medium text-bg transition hover:opacity-85'}
      >
        Connect
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={className ?? 'rounded-md bg-fg px-3.5 py-1.5 text-xs font-medium text-bg transition hover:opacity-85'}
      >
        Connect
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-md border border-line bg-card">
          {connectors.map((c) => (
            <button
              key={c.uid}
              onClick={() => {
                setOpen(false)
                connect({ connector: c })
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg transition hover:bg-line"
            >
              {c.icon && <img src={c.icon} alt="" className="h-4 w-4 rounded" />}
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
