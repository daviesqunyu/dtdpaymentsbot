import Link from 'next/link'
import { ShoppingCart, UserCircle, LogOut } from 'lucide-react'

export default function TopBar({ cartCount }: { cartCount: number }) {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-cyber-border bg-cyber-surface/95 backdrop-blur">
      <div className="flex h-full items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/trade" className="px-3 py-2 rounded-lg text-sm font-medium text-cyber-text hover:bg-cyber-card transition-colors">
            Spot Desk
          </Link>
          <Link href="/smtp" className="px-3 py-2 rounded-lg text-sm font-medium text-cyber-text hover:bg-cyber-card transition-colors">
            SMTP Vault
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/cart"
            className="relative p-2 text-cyber-muted hover:text-cyber-text transition-colors"
          >
            <ShoppingCart size={20} />
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyber-neon text-cyber-bg text-xs font-bold flex items-center justify-center">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </Link>
          <Link href="/profile" className="p-2 text-cyber-muted hover:text-cyber-text transition-colors">
            <UserCircle size={20} />
          </Link>
        </div>
      </div>
    </header>
  )
}
