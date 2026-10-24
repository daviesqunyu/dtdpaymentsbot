'use client'

export const dynamic = 'force-dynamic'

import Shell from '@/components/layout/Shell'
import { SmtpUnlock } from '@/components/smtp/SmtpUnlock'
import { SmtpSender } from '@/components/smtp/SmtpSender'

export default function SmtpPage() {
  return (
    <Shell>
      <div className="max-w-3xl mx-auto py-8">
        <h2 className="text-3xl font-bold text-cyber-text mb-6">SMTP Vault</h2>
        <p className="text-cyber-muted mb-6">Bulk email, carrier SMS gateways, and live OTP inbox. Admin unlock required.</p>
        <div className="space-y-6">
          <SmtpUnlock />
          <div className="border-t border-cyber-border pt-6">
            <SmtpSender />
          </div>
        </div>
      </div>
    </Shell>
  )
}
