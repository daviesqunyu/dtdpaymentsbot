import { motion } from 'framer-motion'

export function Toast({ toast, onClose }: { toast: { message: string; type: 'success' | 'error' | 'info' } | null; onClose: () => void }) {
  if (!toast) return null
  const typeColors = {
    success: 'text-cyber-neonGreen border-cyber-neonGreen',
    error: 'text-cyber-neonRed border-cyber-neonRed',
    info: 'text-cyber-neon border-cyber-neon',
  }
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg border shadow-xl ${typeColors[toast.type]} bg-cyber-surface text-cyber-text`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">{toast.message}</span>
        <button onClick={onClose} className="ml-2 text-cyber-muted hover:text-cyber-text">
          ×
        </button>
      </div>
    </motion.div>
  )
}
