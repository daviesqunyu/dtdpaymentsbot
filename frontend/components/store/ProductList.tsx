'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ProductCard } from '@/components/store/ProductCard'
import { Skeleton } from '@/components/ui/Skeleton'

export function ProductList({ gated = false }: { gated?: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: gated ? ['products', 'gated'] : ['products'],
    queryFn: async () => {
      if (gated) {
        const result = await api.getGatedProducts();
        return result.products || [];
      }
      return api.getProducts();
    },
    refetchInterval: gated ? false : 60000,
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-cyber-card border border-cyber-border rounded-xl p-4">
            <div className="h-48 bg-cyber-surface rounded-lg mb-4 animate-pulse" />
            <SkeletonText lines={3} />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-10 text-cyber-neonRed">
        Failed to load products. {gated ? 'You may need a verified $5+ deposit.' : 'Try again later.'}
      </div>
    )
  }

  const products = (data || [])
  if (!products.length) {
    return <div className="text-center py-10 text-cyber-muted">No products available.</div>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}

function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-cyber-card border border-cyber-border rounded animate-pulse" style={{ width: i === lines - 1 ? '50%' : '100%' }} />
      ))}
    </div>
  )
}
