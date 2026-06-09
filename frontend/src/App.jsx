import { useState } from 'react'
import Header from './components/Header'
import SwapForm from './components/SwapForm'
import EarnSection from './components/EarnSection'
import RecentSwaps from './components/RecentSwaps'
import HowItWorks from './components/HowItWorks'

export default function App() {
  const [tab, setTab] = useState('swap')

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-16 pt-12">
        <div>
          <h1 className="text-xl font-semibold">Swap without gas.</h1>
          <p className="mt-1 text-sm text-sub">
            Sign two messages. Liquidity providers front the gas and earn the fee.
          </p>
        </div>

        <div className="flex gap-4 border-b border-line text-sm">
          {[
            ['swap', 'Swap'],
            ['earn', 'Provide'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b pb-2 transition ${
                tab === key ? 'border-fg font-medium text-fg' : 'border-transparent text-sub hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'swap' ? (
          <>
            <SwapForm />
            <HowItWorks />
          </>
        ) : (
          <EarnSection />
        )}
        <RecentSwaps />
      </main>
    </div>
  )
}
