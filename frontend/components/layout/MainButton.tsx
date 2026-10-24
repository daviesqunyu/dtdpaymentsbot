'use client'

import { useEffect, useRef } from 'react'

export function MainButton({
  text,
  onClick,
  visible = true,
}: {
  text: string
  onClick: () => void
  visible?: boolean
}) {
  const tg = (window as any).Telegram?.WebApp
  const cbRef = useRef(onClick)

  useEffect(() => {
    cbRef.current = onClick
  }, [onClick])

  useEffect(() => {
    if (!tg) return
    tg.MainButton.text = text
    if (visible) {
      tg.MainButton.show()
    } else {
      tg.MainButton.hide()
    }
    const handler = () => cbRef.current()
    tg.MainButton.onClick(handler)
    return () => {
      try { tg.MainButton.offClick(handler) } catch {}
      tg.MainButton.hide()
    }
  }, [text, visible])

  return null
}