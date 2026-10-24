import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CheckoutStep, CartItem, Order } from '@/types'

interface CartState {
  items: CartItem[]
  addItem: (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clear: () => void
  total: () => number
  count: () => number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => {
        const existing = get().items.find((i) => i.productId === item.productId)
        if (existing) {
          set({
            items: get().items.map((i) =>
              i.productId === item.productId
                ? { ...i, quantity: i.quantity + (item.quantity ?? 1) }
                : i
            ),
          })
        } else {
          set({ items: [...get().items, { ...item, quantity: item.quantity ?? 1 }] })
        }
      },
      removeItem: (productId) =>
        set({ items: get().items.filter((i) => i.productId !== productId) }),
      updateQuantity: (productId, quantity) =>
        set({
          items: get().items.map((i) =>
            i.productId === productId ? { ...i, quantity: Math.max(0, quantity) } : i
          ),
        }),
      clear: () => set({ items: [] }),
      total: () =>
        get().items.reduce((sum, i) => sum + i.unitPriceUsd * i.quantity, 0),
      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    {
      name: 'dtd_cart',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

interface CheckoutState {
  step: CheckoutStep
  email: string
  paymentMethod: string | null
  txHash: string | null
  order: Order | null
  setStep: (step: CheckoutStep) => void
  setEmail: (email: string) => void
  setPaymentMethod: (method: string | null) => void
  setTxHash: (hash: string | null) => void
  setOrder: (order: Order | null) => void
  reset: () => void
}

export const useCheckoutStore = create<CheckoutState>((set) => ({
  step: 'idle',
  email: '',
  paymentMethod: null,
  txHash: null,
  order: null,
  setStep: (step) => set({ step }),
  setEmail: (email) => set({ email }),
  setPaymentMethod: (method) => set({ paymentMethod: method }),
  setTxHash: (hash) => set({ txHash: hash }),
  setOrder: (order) => set({ order }),
  reset: () =>
    set({ step: 'idle', email: '', paymentMethod: null, txHash: null, order: null }),
}))

interface UIState {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  theme: 'dark' | 'light' | 'system'
  setTheme: (theme: 'dark' | 'light' | 'system') => void
  toast: { message: string; type: 'success' | 'error' | 'info' } | null
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  hideToast: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: typeof window !== 'undefined' && window.innerWidth < 768,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
  toast: null,
  showToast: (message, type = 'info') => {
    set({ toast: { message, type } })
    setTimeout(() => set({ toast: null }), 4000)
  },
  hideToast: () => set({ toast: null }),
}))
