'use client'

import { useState } from 'react'
import { cryptoTxHashSchema } from '@/lib/validation'
import { AlertBanner } from '@/components/ui/AlertBanner'

export function CryptoHashInput({ onSubmit, loading = false, error }: { onSubmit: (hash: string) => void; loading?: boolean; error?: string | null }) {
  const [hash, setHash] = useState('')

  const isValid = cryptoTxHashSchema.safeParse(hash).success

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = cryptoTxHashSchema.safeParse(hash)
    if (!parsed.success) return
    onSubmit(hash)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <AlertBanner message={error} type="error" />}
      <div className="relative">
        <input
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          type="text"
          placeholder="Paste transaction hash (64 hex chars)"
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          className={`w-full px-4 py-3 rounded-lg border border-cyber-border bg-cyber-surface text-cyber-text font-mono text-xs focus:border-cyber-neon focus:outline-none transition-colors ${!hash ? '' : isValid ? 'border-cyber-neonGreen' : hash.length > 0 ? 'border-cyber-neonRed' : ''}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-cyber-muted">
          {hash.length}/64
        </span>
      </div>
      {!isValid && hash.length > 0 && (
        <p className="text-xs text-cyber-neonRed">Invalid transaction hash format.</p>
      )}
      <button
        type="submit"
        disabled={loading || !isValid || !hash}
        className="w-full px-4 py-3 rounded-lg bg-cyber-neon text-cyber-bg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Verifying…' : 'Verify Payment'}
      </button>
    </form>
  )
}
