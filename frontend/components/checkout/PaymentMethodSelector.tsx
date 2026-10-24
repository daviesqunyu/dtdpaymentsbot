'use client'

import { useState } from 'react'
import { ArrowRight, Mail, Smartphone, Bitcoin, DollarSign } from 'lucide-react'
import { emailSchema } from '@/lib/validation'

export function PaymentMethodSelector({ onSelect }: { onSelect: (method: 'usdt' | 'btc' | 'paystack') => void }) {
  const [selected, setSelected] = useState<'usdt' | 'btc' | 'paystack' | null>(null)

  const methods = [
    { id: 'usdt' as const, label: 'USDT (TRC20)', icon: <DollarSign size={20} color="#00f3ff" />, desc: 'Send to merchant TRC20 address' },
    { id: 'btc' as const, label: 'Bitcoin (BTC)', icon: <Bitcoin size={20} color="#f7931a" />, desc: 'Send to merchant BTC address' },
    { id: 'paystack' as const, label: 'Card / Bank', icon: <Mail size={20} color="#bc13fe" />, desc: 'Paystack secure checkout' },
  ]

  return (
    <div className="space-y-2">
      <p className="text-xs text-cyber-muted uppercase tracking-wider mb-2">Payment method</p>
      <div className="grid gap-2">
        {methods.map((m) => (
          <button
            key={m.id}
            onClick={() => { setSelected(m.id); onSelect(m.id) }}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              selected === m.id
                ? 'border-cyber-neon bg-cyber-neon/10 text-cyber-neon'
                : 'border-cyber-border bg-cyber-surface text-cyber-text hover:border-cyber-neon/50'
            }`}
          >
            {m.icon}
            <div className="flex-1">
              <div className="text-sm font-medium">{m.label}</div>
              <div className="text-xs text-cyber-muted">{m.desc}</div>
            </div>
            {selected === m.id && <ArrowRight size={16} className="text-cyber-neon" />}
          </button>
        ))}
      </div>
    </div>
  )
}
