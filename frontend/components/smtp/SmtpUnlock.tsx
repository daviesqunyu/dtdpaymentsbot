'use client'

import { api } from '@/lib/api'
import { useState } from 'react'
import { AlertBanner } from '@/components/ui/AlertBanner'

export function SmtpUnlock() {
  const [mode, setMode] = useState<'admin' | 'order'>('order')
  const [orderId, setOrderId] = useState('')
  const [email, setEmail] = useState('')
  const [adminJwt, setAdminJwt] = useState('')
  const [unlocked, setUnlocked] = useState<{ token: string; role: string; orderId?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const result = await api.smtpUnlock({
        mode,
        ...(mode === 'order' ? { orderId, email } : { adminJwt }),
      })
      setUnlocked(result)
    } catch (err: any) {
      setError(err.message || 'Unlock failed.')
    }
  }

  if (unlocked) {
    return (
      <div className="bg-cyber-neonGreen/10 border border-cyber-neonGreen rounded-xl p-6">
        <h3 className="text-lg font-bold text-cyber-neonGreen">SMTP Console Unlocked</h3>
        <p className="text-cyber-text">Role: {unlocked.role}{unlocked.orderId ? ` · Order: ${unlocked.orderId}` : ''}</p>
        <p className="text-xs text-cyber-muted mt-2">You can now send email/SMS via the SMTP tabs.</p>
      </div>
    )
  }

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-bold text-cyber-text">Unlock SMTP Vault</h3>
      <div className="flex gap-2">
        <button
          onClick={() => setMode('admin')}
          className={`flex-1 px-3 py-2 rounded border transition-colors ${mode === 'admin' ? 'bg-cyber-neon text-cyber-bg' : 'border-cyber-border text-cyber-text hover:bg-cyber-card'}`}
        >
          Admin
        </button>
        <button
          onClick={() => setMode('order')}
          className={`flex-1 px-3 py-2 rounded border transition-colors ${mode === 'order' ? 'bg-cyber-neon text-cyber-bg' : 'border-cyber-border text-cyber-text hover:bg-cyber-card'}`}
        >
          Order
        </button>
      </div>
      {mode === 'admin' && (
        <input
          value={adminJwt}
          onChange={(e) => setAdminJwt(e.target.value)}
          placeholder="Admin JWT token"
          className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text font-mono text-xs"
        />
      )}
      {mode === 'order' && (
        <>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Order ID"
            className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email on order"
            className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
          />
        </>
      )}
      <button
        onClick={handleUnlock}
        className="w-full px-4 py-3 rounded-lg bg-cyber-neon text-cyber-bg font-bold"
      >
        Unlock
      </button>
      {error && <AlertBanner message={error} type="error" dismissible onDismiss={() => setError(null)} />}
    </div>
  )
}
