/* DTD Store - Unified Catalog */
const PRODUCT_CATALOG = [
  {
    id: "smtp-elite",
    name: "SMTP Server Elite",
    category: "infrastructure",
    subcategory: "SMTP",
    price: 29.99,
    badge: "SECURE",
    badgeColor: "accent",
    description: "High-volume SMTP server with dedicated IP and auto-scaling. Perfect for transactional emails and marketing campaigns.",
    image: "https://images.unsplash.com/photo-1558494949-ef648b0677c0?w=800&h=600&fit=crop",
    inStock: true,
    featured: true
  },
  {
    id: "smtp-pro",
    name: "SMTP Server Pro",
    category: "infrastructure",
    subcategory: "SMTP",
    price: 49.99,
    badge: "PREMIUM",
    badgeColor: "danger",
    description: "Dedicated IP + 10K emails/day + real-time analytics. Enterprise-grade email delivery infrastructure.",
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&h=600&fit=crop",
    inStock: true,
    featured: true
  },
  {
    id: "vault-pro",
    name: "Encrypted Vault Pro",
    category: "storage",
    subcategory: "Vaults",
    price: 19.99,
    badge: "STOCK",
    badgeColor: "accent",
    description: "End-to-end encrypted storage with 1TB capacity. Military-grade encryption for your sensitive data.",
    image: "https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=800&h=600&fit=crop",
    inStock: true,
    featured: false
  },
  {
    id: "vault-enterprise",
    name: "Encrypted Vault Enterprise",
    category: "storage",
    subcategory: "Vaults",
    price: 59.99,
    badge: "LIMITED",
    badgeColor: "warning",
    description: "Unlimited storage + team collaboration + priority support. Built for teams and enterprises.",
    image: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&h=600&fit=crop",
    inStock: true,
    featured: true
  },
  {
    id: "crypto-wallet",
    name: "Crypto Wallet Pro",
    category: "accounts",
    subcategory: "Wallets",
    price: 39.99,
    badge: "VERIFIED",
    badgeColor: "info",
    description: "Multi-currency wallet with 2FA and hardware wallet integration. Secure crypto management.",
    image: "https://images.unsplash.com/photo-1639762681485-07477f95aa40?w=800&h=600&fit=crop",
    inStock: true,
    featured: false
  },
  {
    id: "domain-portfolio",
    name: "Premium Domain Portfolio",
    category: "accounts",
    subcategory: "Domains",
    price: 79.99,
    badge: "PREMIUM",
    badgeColor: "danger",
    description: "100+ premium domains with DNS management and forwarding. Instant transfer ready.",
    image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&h=600&fit=crop",
    inStock: true,
    featured: true
  },
  {
    id: "dns-manager",
    name: "DNS Manager Elite",
    category: "infrastructure",
    subcategory: "DNS",
    price: 14.99,
    badge: "ESSENTIAL",
    badgeColor: "info",
    description: "Complete DNS management with premium DNS resolution. Fast, reliable, secure.",
    image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&h=600&fit=crop",
    inStock: true,
    featured: false
  },
  {
    id: "vpn-plus",
    name: "VPN Access Plus",
    category: "storage",
    subcategory: "VPN",
    price: 12.99,
    badge: "STOCK",
    badgeColor: "accent",
    description: "High-speed VPN with 50+ server locations and no-logs policy. Unrestricted browsing.",
    image: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&h=600&fit=crop",
    inStock: true,
    featured: false
  },
  {
    id: "rdp-basic",
    name: "Windows RDP - Basic",
    category: "rdp",
    subcategory: "VPS",
    price: 39.99,
    badge: "ACTIVE",
    badgeColor: "accent",
    description: "Windows Server RDP with 2 vCPU, 4GB RAM, 100GB SSD storage. Full admin access. Instant activation.",
    image: "https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=800&h=600&fit=crop",
    inStock: true,
    featured: true,
    active: true
  },
  {
    id: "rdp-pro",
    name: "Windows RDP - Pro",
    category: "rdp",
    subcategory: "VPS",
    price: 79.99,
    badge: "ACTIVE",
    badgeColor: "info",
    description: "Windows Server RDP with 4 vCPU, 8GB RAM, 200GB SSD, dedicated IP. Enhanced performance. 24/7 uptime.",
    image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=600&fit=crop",
    inStock: true,
    featured: true,
    active: true
  },
  {
    id: "ai-bot",
    name: "AI Trading Bot",
    category: "ai",
    subcategory: "Automation",
    price: 99.99,
    badge: "GATED",
    badgeColor: "danger",
    description: "Automated crypto trading bot with Binance integration and advanced risk management.",
    image: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=600&fit=crop",
    inStock: true,
    featured: false,
    gated: true
  },
  {
    id: "smtp-vault",
    name: "SMTP Vault Credentials",
    category: "gated",
    subcategory: "Premium",
    price: 79.99,
    badge: "GATED",
    badgeColor: "danger",
    description: "Premium SMTP credentials for high-volume email delivery and marketing campaigns.",
    image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&h=600&fit=crop",
    inStock: true,
    featured: false,
    gated: true
  }
];

// Category definitions
const CATEGORIES = [
  { id: "all", name: "All Products", icon: "grid" },
  { id: "infrastructure", name: "Infrastructure/SMTP", icon: "server" },
  { id: "storage", name: "Storage/Vaults", icon: "hard-drive" },
  { id: "accounts", name: "Accounts/Domains", icon: "user-circle" },
  { id: "rdp", name: "RDP/VPS", icon: "desktop" },
  { id: "ai", name: "AI Tools", icon: "brain" },
  { id: "gated", name: "Gated/Premium", icon: "lock" }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PRODUCT_CATALOG, CATEGORIES };
}
