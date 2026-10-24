import { useEffect } from 'react'

export function TelegramTheme() {
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp
    if (!tg) return
    const root = document.documentElement
    const apply = () => {
      const { themeParams } = tg
      if (themeParams.bg_color) root.style.setProperty('--tg-bg', themeParams.bg_color)
      if (themeParams.text_color) root.style.setProperty('--tg-text', themeParams.text_color)
      if (themeParams.link_color) root.style.setProperty('--tg-link', themeParams.link_color)
      if (themeParams.button_color) root.style.setProperty('--tg-button', themeParams.button_color)
      if (themeParams.button_text_color) root.style.setProperty('--tg-button-text', themeParams.button_text_color)
      root.classList.add('tma')
    }
    apply()
    tg.ready()
    tg.expand()
  }, [])
  return null
}
