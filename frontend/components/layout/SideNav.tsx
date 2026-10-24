'use client'

import { useEffect, useState } from 'react'
import { Menu, X, Store, CreditCard, Bot, ShieldAlert, MessageSquare, Phone, TrendingUp } from 'lucide-react'

export default function SideNav({ className = '' }) {
  const [open, setOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  const navItems = [
    { href: '/', icon: <Store size={20} />, label: 'Store' },
    { href: '/dtdshopcc', icon: <ShieldAlert size={20} />, label: 'DTDSHOP.CC', badge: 'Gated' },
    { href: '/payment', icon: <CreditCard size={20} />, label: 'Payment' },
    { href: '/chat', icon: <MessageSquare size={20} />, label: 'Store Chat' },
    { href: '/trade', icon: <TrendingUp size={20} />, label: 'Spot Desk' },
    { href: '/smtp', icon: <Bot size={20} />, label: 'SMTP Vault' },
  ]

  useEffect(() => {
    setOpen(typeof window !== 'undefined' && window.innerWidth >= 768)
    setIsMobile(typeof window !== 'undefined' && window.innerWidth < 768)
  }, [])

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-64 bg-cyber-surface border-r border-cyber-border transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'} ${className}`}
      aria-label="Store navigation"
    >
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-between px-6 border-b border-cyber-border">
          <a href="/" className="flex items-center gap-2">
            <span className="w-10 h-10 rounded bg-cyber-card border border-cyber-border flex items-center justify-center">
              <Store size={24} className="text-cyber-neon" />
            </span>
            <span className="font-sora font-bold text-xl text-cyber-text tracking-tight">DTD<span className="text-cyber-neon">STORE</span></span>
          </a>
          {isMobile && (
            <button onClick={() => setOpen(false)} className="p-2 text-cyber-muted hover:text-cyber-text">
              <X size={20} />
            </button>
          )}
        </div>
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-cyber-muted hover:text-cyber-text hover:bg-cyber-card"
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge && (
                <span className="ml-auto px-2 py-0.5 rounded text-xs font-mono bg-cyber-border text-cyber-neon">
                  {item.badge}
                </span>
              )}
            </a>
          ))}
        </nav>
        <div className="p-4 border-t border-cyber-border">
          <p className="text-xs text-cyber-muted mb-2">Network status</p>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyber-neonGreen animate-pulse" />
            <span className="text-xs text-cyber-neonGreen font-mono">ONLINE</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
