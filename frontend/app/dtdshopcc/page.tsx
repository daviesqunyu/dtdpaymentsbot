'use client'

export const dynamic = 'force-dynamic'

import Shell from '@/components/layout/Shell'
import { ProductList } from '@/components/store/ProductList'
import { BackButton } from '@/components/layout/BackButton'
import { MainButton } from '@/components/layout/MainButton'
import { AlertBanner } from '@/components/ui/AlertBanner'
import { api } from '@/lib/api'
import { useEffect, useState } from 'react'

export default function GatedCatalog() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getGatedProducts()
      .then((data) => {
        setUnlocked(data.unlocked)
        if (!data.unlocked) setError('Gated catalog requires a verified $5+ crypto deposit.')
      })
      .catch((err) => {
        setError(err.message || 'Failed to load gated catalog.')
        setUnlocked(false)
      })
  }, [])

  return (
    <Shell>
      <BackButton onBack={() => window.history.back()} />
      <MainButton text="Checkout" visible={!!unlocked} onClick={() => window.location.href = '/payment'} />
      <div className="max-w-7xl mx-auto py-8">
        <h2 className="text-3xl font-bold text-cyber-text mb-6">DTDSHOP.CC — Gated Catalog</h2>
        {!unlocked && (
          <AlertBanner message="This catalog is locked. Complete a verified $5+ USDT/BTC crypto deposit to unlock premium products." type="error" dismissible onDismiss={() => setError(null)} />
        )}
        {error && <AlertBanner message={error} type="error" dismissible onDismiss={() => setError(null)} />}
        {unlocked ? <ProductList gated /> : null}
      </div>
    </Shell>
  )
}
