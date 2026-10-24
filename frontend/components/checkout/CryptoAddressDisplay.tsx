export function CryptoAddressDisplay({
  network,
  address,
  onCopy,
}: {
  network: 'USDT TRC20' | 'Bitcoin'
  address: string
  onCopy: () => void
}) {
  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded bg-cyber-surface flex items-center justify-center text-xs font-bold">
          {network === 'USDT TRC20' ? '₮' : '₿'}
        </span>
        <span className="font-mono text-sm text-cyber-text">{network}</span>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <input
          readOnly
          value={address}
          className="flex-1 bg-cyber-surface border border-cyber-border rounded px-3 py-2 text-xs font-mono text-cyber-text"
        />
        <button onClick={onCopy} className="p-2 text-cyber-muted hover:text-cyber-neon">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="1" width="12" height="12" rx="2" ry="2" />
            <path d="M8 13h4" />
            <path d="M4 15h10" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-cyber-muted">Send exactly the order amount to this address.</p>
    </div>
  )
}
