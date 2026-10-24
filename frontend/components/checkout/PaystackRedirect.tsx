'use client'

import { useEffect } from 'react'

export function PaystackRedirect({ authorizationUrl, email, reference }: { authorizationUrl: string; email: string; reference: string }) {
  // Auto-redirect to Paystack on mount
  useEffect(() => {
    if (authorizationUrl) {
      const tg = (window as any).Telegram?.WebApp
      if (tg?.openInvoice) {
        tg.openInvoice(authorizationUrl)
      } else {
        window.location.href = authorizationUrl
      }
    }
  }, [authorizationUrl])

  return null
}
