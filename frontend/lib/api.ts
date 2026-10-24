import type { Order, Product, User, Ticker } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL || ''

async function request<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input.toString(), {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Request failed (${res.status})`)
  }
  return res.json()
}

export const api = {
  // Config
  getConfig: () => request<{ paystackPublicKey: string; usdtTrc20Address: string; btcAddress: string; paymentOptions: any[] }>(`${BASE}/api/config`),

  // Products
  getProducts: () => request<Product[]>(`${BASE}/api/products`),
  getGatedProducts: () => request<{ unlocked: boolean; products: Product[] }>(`${BASE}/api/products/gated`),

  // Orders
  createOrder: (body: any) => request<Order>(`${BASE}/api/orders`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  getOrderStatus: (orderId: string, email: string) =>
    request<Order>(`${BASE}/api/orders/status?orderId=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`),

  // Crypto verification
  verifyCrypto: (body: { txHash: string; orderId: string; network: string; walletAddress: string; amountPaid: number }) =>
    request<{ verified: boolean; orderId: string; txHash: string; network: string; amountReceived: number; confirmations: number }>(
      `${BASE}/api/payments/crypto/verify`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  // Paystack
  initializePaystack: (body: { email: string; name: string; amountUsd: number; reference?: string; cartItems?: string }) =>
    request<{ reference: string; accessCode: string; authorizationUrl: string }>(
      `${BASE}/api/paystack/initialize`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  verifyPaystack: (reference: string) =>
    request<{ paid: boolean; amount: number; currency: string; reference: string }>(
      `${BASE}/api/paystack/verify`,
      { method: 'POST', body: JSON.stringify({ reference }) }
    ),

  // SMTP (admin/order scoped)
  smtpUnlock: (body: { mode: 'admin' | 'order'; orderId?: string; email?: string; adminJwt?: string }) =>
    request<{ token: string; role: string; orderId?: string; message: string }>(
      `${BASE}/api/smtp/unlock`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  smtpSendEmail: (body: { to: string[]; subject: string; text: string }) =>
    request(`${BASE}/api/smtp/send-email`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  smtpSendSms: (body: { to: string[]; text: string; gwUser: string; gwPass: string; gwUrl?: string }) =>
    request(`${BASE}/api/smtp/send-sms`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  smtpListOtps: (watch?: string) =>
    request<{ items: any[]; count: number }>(
      `${BASE}/api/smtp/otp${watch ? `?watch=${encodeURIComponent(watch)}` : ''}`
    ),
  smtpOtp: (body: { action: string; gwUser: string; gwPass: string; gwUrl?: string; phones?: string[]; label?: string; pull?: boolean }) =>
    request(`${BASE}/api/smtp/otp`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  smtpListJobs: () => request<{ jobs: any[] }>(`${BASE}/api/smtp/jobs`),

  // Chat
  sendChatMessage: (body: { message: string; contact?: string }) =>
    request(`${BASE}/api/telegram/message`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export type { Order, Product, User, Ticker }
