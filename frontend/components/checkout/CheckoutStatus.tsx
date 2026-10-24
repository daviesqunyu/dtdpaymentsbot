import { Loader2, CheckCircle2, Clock } from 'lucide-react'

export function CheckoutStatus({ step }: { step: string }) {
  const labels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    idle: { label: 'Ready to start', icon: <Clock size={18} />, color: 'text-cyber-muted' },
    cart: { label: 'Cart', icon: <Loader2 size={18} className="animate-spin" />, color: 'text-cyber-muted' },
    email: { label: 'Enter email', icon: <Loader2 size={18} className="animate-spin" />, color: 'text-cyber-muted' },
    payment_method: { label: 'Choose payment', icon: <Loader2 size={18} className="animate-spin" />, color: 'text-cyber-muted' },
    crypto_hash: { label: 'Verify crypto', icon: <Loader2 size={18} className="animate-spin" />, color: 'text-cyber-muted' },
    paystack_redirect: { label: 'Paystack redirect', icon: <Loader2 size={18} className="animate-spin" />, color: 'text-cyber-muted' },
    payment_pending: { label: 'Payment pending', icon: <Loader2 size={18} className="animate-spin" />, color: 'text-cyber-neon' },
    payment_verifying: { label: 'Verifying on-chain…', icon: <Loader2 size={18} className="animate-spin" />, color: 'text-cyber-neon' },
    paid: { label: 'Paid', icon: <CheckCircle2 size={18} className="text-cyber-neonGreen" />, color: 'text-cyber-neonGreen' },
    delivered: { label: 'Delivered', icon: <CheckCircle2 size={18} className="text-cyber-neonGreen" />, color: 'text-cyber-neonGreen' },
    tracking: { label: 'Tracking', icon: <Clock size={18} />, color: 'text-cyber-neon' },
  }

  const info = labels[step] || labels.idle
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cyber-border bg-cyber-surface">
      {info.icon}
      <span className={`text-sm font-mono ${info.color}`}>{info.label}</span>
    </div>
  )
}
