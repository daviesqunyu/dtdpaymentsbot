'use client'

import { Plus, Minus, ShoppingCart } from 'lucide-react'
import { useCartStore } from '@/lib/store'
import { useState } from 'react'

export function ProductCard({ product }: { product: any }) {
  const { addItem, count } = useCartStore()
  const [qty, setQty] = useState(1)

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden hover:border-cyber-neon/50 transition-colors group">
      <div className="h-48 bg-cyber-surface relative overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-cyber-muted text-xs">No image</div>
        )}
        <div className="absolute top-2 right-2 bg-cyber-neon/20 backdrop-blur px-2 py-1 rounded text-[10px] font-bold text-cyber-neon">
          ${product.priceUsd}
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-bold text-cyber-text line-clamp-1">{product.name}</h3>
        <p className="text-xs text-cyber-muted line-clamp-2 mt-1">{product.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-sm text-cyber-neonGreen">${product.priceUsd}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty === 1}
              className="w-6 h-6 rounded border border-cyber-border bg-cyber-surface text-cyber-text text-xs disabled:opacity-50"
            >
              <Minus size={14} />
            </button>
            <span className="w-6 text-center text-xs text-cyber-text">{qty}</span>
            <button
              onClick={() => setQty((q) => q + 1)}
              className="w-6 h-6 rounded border border-cyber-border bg-cyber-surface text-cyber-text text-xs"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <button
          onClick={() => addItem({ productId: product.id, productName: product.name, quantity: qty, unitPriceUsd: product.priceUsd })}
          className="w-full mt-3 px-3 py-2 rounded bg-cyber-neon text-cyber-bg font-bold text-sm disabled:opacity-50"
        >
          <ShoppingCart size={14} className="mr-1" /> Add to cart ({count()})
        </button>
      </div>
    </div>
  )
}

