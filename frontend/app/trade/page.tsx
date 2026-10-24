'use client'

export const dynamic = 'force-dynamic'

import Shell from '@/components/layout/Shell'

export default function TradePage() {
  return (
    <Shell>
      <div className="max-w-7xl mx-auto py-8">
        <h2 className="text-3xl font-bold text-cyber-text mb-6">Spot Desk</h2>
        <p className="text-cyber-muted mb-8">Live Binance trading center — candlestick charts, order book, and order execution.</p>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-8 text-center">
          <p className="text-cyber-muted">Trade Desk coming soon — connect your Binance API keys (localStorage only, never transmitted).</p>
        </div>
      </div>
    </Shell>
  )
}
