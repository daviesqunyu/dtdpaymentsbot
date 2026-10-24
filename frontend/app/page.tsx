export default function Page() {
  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-4xl font-bold text-cyber-text mb-6">DTD Store</h1>
      <p className="text-cyber-muted mb-8">Premium digital products. Secure payments via Paystack, USDT TRC20, and Bitcoin.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 hover:border-cyber-neon/50 transition-colors group">
          <h3 className="font-bold text-cyber-neon mb-2">🛍 Storefront</h3>
          <p className="text-sm text-cyber-muted mb-4">Browse and purchase digital products with instant delivery.</p>
          <a href="/payment" className="inline-flex items-center gap-1 text-cyber-neon text-sm font-medium hover:underline">
            Start Shopping →
          </a>
        </div>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 hover:border-cyber-neonPurple/50 transition-colors group">
          <h3 className="font-bold text-cyber-neonPurple mb-2">🔒 DTDSHOP.CC</h3>
          <p className="text-sm text-cyber-muted mb-4">Gated catalog — requires verified $5+ crypto deposit.</p>
          <a href="/dtdshopcc" className="inline-flex items-center gap-1 text-cyber-neonPurple text-sm font-medium hover:underline">
            Unlock Catalog →
          </a>
        </div>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 hover:border-cyber-neonGreen/50 transition-colors group">
          <h3 className="font-bold text-cyber-neonGreen mb-2">💱 Spot Desk</h3>
          <p className="text-sm text-cyber-muted mb-4">Live Binance trading, charts, and order execution.</p>
          <a href="/trade" className="inline-flex items-center gap-1 text-cyber-neonGreen text-sm font-medium hover:underline">
            Open Trading →
          </a>
        </div>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 hover:border-cyber-neon/50 transition-colors group">
          <h3 className="font-bold text-cyber-neon mb-2">💬 Store Chat</h3>
          <p className="text-sm text-cyber-muted mb-4">Live chat feed mirrored with Telegram auth + callback requests.</p>
          <a href="/chat" className="inline-flex items-center gap-1 text-cyber-neon text-sm font-medium hover:underline">
            Open Chat →
          </a>
        </div>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 hover:border-cyber-neonPurple/50 transition-colors group">
          <h3 className="font-bold text-cyber-neonPurple mb-2">📮 SMTP Vault</h3>
          <p className="text-sm text-cyber-muted mb-4">Bulk email, carrier SMS gateways, live OTP inbox.</p>
          <a href="/smtp" className="inline-flex items-center gap-1 text-cyber-neonPurple text-sm font-medium hover:underline">
            Open Vault →
          </a>
        </div>
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 hover:border-cyber-neon/50 transition-colors group">
          <h3 className="font-bold text-cyber-neon mb-2">📦 Track Order</h3>
          <p className="text-sm text-cyber-muted mb-4">Check payment and delivery status by Order ID.</p>
          <a href="/track" className="inline-flex items-center gap-1 text-cyber-neon text-sm font-medium hover:underline">
            Track →
          </a>
        </div>
      </div>
    </div>
  )
}
