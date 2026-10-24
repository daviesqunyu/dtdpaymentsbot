'use client'

import { api } from '@/lib/api'
import { useCheckoutStore } from '@/lib/store'
import { EmailInputForm } from '@/components/checkout/EmailInputForm'
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector'
import { CryptoHashInput } from '@/components/checkout/CryptoHashInput'
import { CryptoAddressDisplay } from '@/components/checkout/CryptoAddressDisplay'
import { PaystackRedirect } from '@/components/checkout/PaystackRedirect'
import { DeliveryConfirm } from '@/components/checkout/DeliveryConfirm'
import { CheckoutStatus } from '@/components/checkout/CheckoutStatus'
import { AlertBanner } from '@/components/ui/AlertBanner'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

export function CheckoutFlow({ totalUsd }: { totalUsd: number }) {
  const { step, email, paymentMethod, txHash, order, setStep, setEmail, setPaymentMethod, setTxHash, setOrder, reset } = useCheckoutStore()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (order?.paymentStatus === 'paid') {
      setStep('paid')
    }
  }, [order, setStep])

  const handleCreateOrder = async (method: 'usdt' | 'btc' | 'paystack') => {
    setError(null)
    setLoading(true)
    try {
      const created = await api.createOrder({
        customerName: 'Store Customer',
        customerEmail: email,
        paymentMethod: method,
        totalUsd,
        items: [], // populated from cart in production
      })
      setOrder(created as any)
      if (method === 'paystack') {
        const init = await api.initializePaystack({
          email,
          name: 'Store Customer',
          amountUsd: totalUsd,
          reference: created.id,
        })
        setStep('paystack_redirect')
        // In production, render PaystackRedirect component with init.authorizationUrl
      } else {
        setStep('crypto_hash')
      }
    } catch (err: any) {
      setError(err.message || 'Order creation failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCrypto = async () => {
    if (!order || !txHash) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.verifyCrypto({
        txHash: txHash,
        orderId: order.id,
        network: paymentMethod === 'btc' ? 'btc' : 'trc20',
        walletAddress: '', // filled from user profile in production
        amountPaid: totalUsd,
      })
      setOrder({ ...order, paymentStatus: 'paid' as const } as any)
      setStep('paid')
    } catch (err: any) {
      setError(err.message || 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <CheckoutStatus step={step} />

      {step === 'email' && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="text-lg font-bold text-cyber-text mb-4">Delivery Email</h3>
          <EmailInputForm onSubmit={(email) => { setEmail(email); setStep('payment_method') }} />
        </div>
      )}

      {step === 'payment_method' && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="text-lg font-bold text-cyber-text mb-4">Choose Payment</h3>
          <PaymentMethodSelector onSelect={(method) => { setPaymentMethod(method); handleCreateOrder(method) }} />
        </div>
      )}

      {step === 'crypto_hash' && order && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="text-lg font-bold text-cyber-text mb-4">Verify Crypto Payment</h3>
          <p className="text-sm text-cyber-muted mb-4">Paste the transaction hash after sending funds.</p>
          <CryptoAddressDisplay
            network={paymentMethod === 'btc' ? 'Bitcoin' : 'USDT TRC20'}
            address={paymentMethod === 'btc' ? 'bc1q...' : 'T...'}
            onCopy={() => {}}
          />
          <CryptoHashInput
            onSubmit={(hash) => { setTxHash(hash); handleVerifyCrypto() }}
            loading={loading}
            error={error}
          />
        </div>
      )}

      {step === 'paystack_redirect' && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 text-center py-10">
          <Loader2 className="mx-auto animate-spin mb-3" />
          <p className="text-cyber-text">Redirecting to Paystack…</p>
        </div>
      )}

      {step === 'paid' && order && (
        <DeliveryConfirm
          orderId={order.id}
          downloadUrl={`/download?order=${order.id}&email=${encodeURIComponent(order.email)}`}
          email={order.email}
        />
      )}

      {error && <AlertBanner message={error} type="error" dismissible onDismiss={() => setError(null)} />}
    </div>
  )
}
