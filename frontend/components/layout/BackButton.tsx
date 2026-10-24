import { useEffect, useRef } from 'react'

export function BackButton({ onBack }: { onBack: () => void }) {
  const tgRef = useRef<any>(null)
  const cbRef = useRef(onBack)

  useEffect(() => {
    cbRef.current = onBack
  }, [onBack])

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp
    tgRef.current = tg
    if (!tg) return
    tg.BackButton.show()
    const handler = () => cbRef.current()
    tg.BackButton.onClick(handler)
    return () => {
      try { tg.BackButton.offClick(handler) } catch {}
      tg.BackButton.hide()
    }
  }, [])

  return null
}
