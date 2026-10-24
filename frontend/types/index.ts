export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type CheckoutStep =
  | 'idle'
  | 'cart'
  | 'email'
  | 'payment_method'
  | 'crypto_hash'
  | 'paystack_redirect'
  | 'payment_pending'
  | 'payment_verifying'
  | 'paid'
  | 'delivered'
  | 'tracking'

export interface CartItem {
  productId: string
  productName: string
  quantity: number
  unitPriceUsd: number
}

export interface Order {
  id: string
  userId?: string
  email: string
  paymentMethod: string
  paymentStatus: OrderStatus
  orderStatus: string
  txHash?: string
  amountPaid?: number
  totalUsd: number
  createdAt: string
  items: Array<{
    productName: string
    quantity: number
    unitPriceUsd: number
  }>
}

export interface Product {
  id: string
  name: string
  description: string
  priceUsd: number
  stockCount: number
  isGated: boolean
  isActive: boolean
  digitalAssetUrl?: string
}

export interface User {
  id: string
  telegramId?: string
  email?: string
  role: 'admin' | 'moderator' | 'user'
  cryptoWallet?: string
  verifiedDepositStatus: boolean
}

export interface Ticker {
  symbol: string
  last: number
  changePct: number
  bid: number
  ask: number
  volume: number
}

export interface ChatPost {
  id: string
  userId?: string
  message: string
  mediaUrls: string[]
  createdAt: string
  mirroredToTelegram: boolean
}
