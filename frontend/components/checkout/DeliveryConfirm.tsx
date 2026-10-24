'use client'

import { ArrowRight, CheckCircle2, Mail, FileText } from 'lucide-react'

export function DeliveryConfirm({ orderId, downloadUrl, email }: { orderId: string; downloadUrl?: string; email?: string }) {
  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle2 size={24} className="text-cyber-neonGreen" />
        <h3 className="text-lg font-bold text-cyber-text">Order Confirmed</h3>
      </div>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between border-b border-cyber-border pb-2">
          <span className="text-cyber-muted">Order ID</span>
          <span className="font-mono text-cyber-text">{orderId}</span>
        </div>
        {email && (
          <div className="flex justify-between border-b border-cyber-border pb-2">
            <span className="text-cyber-muted">Delivery email</span>
            <span className="font-mono text-cyber-text">{email}</span>
          </div>
        )}
        {downloadUrl && (
          <div className="flex justify-between border-b border-cyber-border pb-2">
            <span className="text-cyber-muted">Download link</span>
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="text-cyber-neon hover:underline">
              Download digital item
            </a>
          </div>
        )}
      </div>
      <p className="text-xs text-cyber-muted mt-4">
        A receipt has been sent to your Telegram and email. Save your Order ID for support.
      </p>
      <a href="/track" className="mt-4 inline-flex items-center gap-2 text-sm text-cyber-neon hover:text-cyber-neon/80">
        Track order <ArrowRight size={16} />
      </a>
    </div>
  )
}
