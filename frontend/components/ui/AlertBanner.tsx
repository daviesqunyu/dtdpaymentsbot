import { X, Copy, CheckCircle2, AlertCircle } from 'lucide-react'

export function AlertBanner({
  message,
  type = 'info',
  dismissible = true,
  onDismiss,
}: {
  message: string
  type?: 'success' | 'error' | 'info' | 'warning'
  dismissible?: boolean
  onDismiss?: () => void
}) {
  const variants = {
    success: 'border-cyber-neonGreen bg-cyber-neonGreen/10 text-cyber-neonGreen',
    error: 'border-cyber-neonRed bg-cyber-neonRed/10 text-cyber-neonRed',
    warning: 'border-cyber-neonPurple bg-cyber-neonPurple/10 text-cyber-neonPurple',
    info: 'border-cyber-neon bg-cyber-neon/10 text-cyber-neon',
  }
  const icons = {
    success: <CheckCircle2 size={18} />,
    error: <AlertCircle size={18} />,
    warning: <AlertCircle size={18} />,
    info: <X size={18} />,
  }
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${variants[type]}`}>
      <div className="flex h-5 shrink-0 items-center">{icons[type]}</div>
      <p className="text-sm text-cyber-text leading-relaxed">{message}</p>
      {dismissible && onDismiss && (
        <button onClick={onDismiss} className="ml-auto p-1 text-cyber-muted hover:text-cyber-text">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

export function CopyButton({ value, onCopied }: { value: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false)
  useState<boolean>(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    onCopied?.()
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 px-3 py-1.5 rounded border border-cyber-border bg-cyber-surface text-xs text-cyber-muted hover:text-cyber-text transition-colors"
    >
      {copied ? <CheckCircle2 size={16} className="text-cyber-neonGreen" /> : <Copy size={16} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

import { useState } from 'react'
