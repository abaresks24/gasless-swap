const STEPS = [
  ['Sign permit', 'no gas'],
  ['Sign intent', 'no gas'],
  ['Executor settles', 'you receive wETH'],
]

export default function HowItWorks() {
  return (
    <section className="text-xs text-sub">
      <ol className="flex flex-col gap-1.5">
        {STEPS.map(([title, sub], i) => (
          <li key={title} className="flex gap-3">
            <span className="font-mono">{i + 1}</span>
            <span className="text-fg">{title}</span>
            <span>{sub}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3">
        You sign, you never pay gas. The executor is reimbursed by the LP vault, which keeps a 0.3%
        fee on each swap.
      </p>
    </section>
  )
}
