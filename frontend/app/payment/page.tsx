'use client'

export const dynamic = 'force-dynamic'

import Shell from '@/components/layout/Shell'
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow'

export default function PaymentPage() {
  return (
    <Shell>
      <div className="max-w-2xl mx-auto py-8">
        <h2 className="text-3xl font-bold text-cyber-text mb-6">Secure Checkout</h2>
        <CheckoutFlow totalUsd={49} />
      </div>
    </Shell>
  )
}
