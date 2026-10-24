'use client'

export const dynamic = 'force-dynamic'

import Shell from '@/components/layout/Shell'

export default function TrackPage() {
  return (
    <Shell>
      <div className="max-w-2xl mx-auto py-8">
        <h2 className="text-3xl font-bold text-cyber-text mb-6">Track Order</h2>
        <p className="text-cyber-muted mb-6">Enter your Order ID and email to check payment and delivery status.</p>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <p className="text-cyber-muted text-sm">Order tracking form — enter your Order ID and email above.</p>
        </div>
      </div>
    </Shell>
  )
}
