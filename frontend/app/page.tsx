import { metadata } from '@/app/layout'

export default function Page() {
  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-4xl font-bold text-cyber-text mb-6">DTD Store</h1>
      <p className="text-cyber-muted mb-8">Premium digital products. Secure payments via Paystack, USDT TRC20, and Bitcoin.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="font-bold text-cyber-neon mb-2">🛍 Storefront</h3>
          <p className="text-sm text-cyber-muted">Browse and purchase digital products with instant delivery.</p>
        </div>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="font-bold text-cyber-neonPurple mb-2">🔒 DTDSHOP.CC</h3>
          <p className="text-sm text-cyber-muted">Gated catalog — requires verified $5+ crypto deposit.</p>
        </div>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="font-bold text-cyber-neonGreen mb-2">💱 Spot Desk</h3>
          <p className="text-sm text-cyber-muted">Live Binance trading, charts, and order execution.</p>
        </div>
      </div>
    </div>
  )
}
