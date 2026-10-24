import { useEffect } from 'react'

export function BackButton({ onBack }: { onBack: () => void }) {
  const tg = (window as any).Telegram?.WebApp
  useEffect(() => {
    if (!tg) return
    tg.BackButton.show()
    tg.BackButton.onClick(onBack)
    return () => {
      try { tg.BackButton.offClick(onBack) } catch {}
      tg.BackButton.hide()
    }
  }, [onBack])
  return null
}
