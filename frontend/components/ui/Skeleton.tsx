import { motion } from 'framer-motion'

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`animate-pulse bg-cyber-card border border-cyber-border rounded-lg ${className}`}
    />
  )
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="h-4 bg-cyber-card border border-cyber-border rounded w-full"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  )
}

export function ProductSkeleton() {
  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-4">
      <div className="h-48 bg-cyber-surface rounded-lg mb-4" />
      <SkeletonText lines={3} />
    </div>
  )
}
