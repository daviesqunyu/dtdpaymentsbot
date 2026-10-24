import { useEffect, useCallback } from 'react'

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void
        expand: () => void
        close: () => void
        sendData: (data: string) => void
        switchInlineQuery: (query: string, chooseChat?: boolean) => void
        openTelegramLink: (url: string) => void
        openLink: (url: string) => void
        openInvoice: (invoiceUrl: string, callback?: (status: string) => void) => void
        showAlert: (message: string, callback?: () => void) => void
        showConfirm: (message: string, callback?: (ok: boolean) => void) => void
        showPopup: (params: { title?: string; message: string; buttons?: { id?: string; type?: string; text: string }[] }, callback?: (buttonId: string) => void) => void
        showScanQrPopup: (params: { min_version?: string; text?: string }, callback?: (payload: string) => void) => void
        readTextFromClipboard: (callback?: (text: string) => void) => void
        writeTextToClipboard: (text: string) => void
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void
          selectionChanged: () => void
        }
        MainButton: {
          text: string
          textColor: string
          color: string
          isVisible: boolean
          isActive: boolean
          isProgressVisible: boolean
          show: () => void
          hide: () => void
          enable: () => void
          disable: () => void
          showProgress: (leaveActive?: boolean) => void
          hideProgress: () => void
          onClick: (fn: () => void) => void
          offClick: (fn: () => void) => void
        }
        BackButton: {
          show: () => void
          hide: () => void
          onClick: (fn: () => void) => void
          offClick: (fn: () => void) => void
        }
        SettingsButton: {
          show: () => void
          hide: () => void
          onClick: (fn: () => void) => void
          offClick: (fn: () => void) => void
        }
        initData: string
        initDataUnsafe: {
          user?: { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string }
          chat_instance?: string
          chat_type?: string
          start_param?: string
          auth_date?: number
          hash?: string
        }
        version: string
        platform: string
        themeParams: {
          bg_color?: string
          secondary_bg_color?: string
          text_color?: string
          hint_color?: string
          link_color?: string
          button_color?: string
          button_text_color?: string
        }
        isExpanded: boolean
        isClosingConfirmationEnabled: boolean
        enableClosingConfirmation: () => void
        disableClosingConfirmation: () => void
      }
    }
  }
}

export function isTelegramWebApp(): boolean {
  return typeof window !== 'undefined' && !!window.Telegram?.WebApp
}

export function useTelegramWebApp() {
  const tg = (typeof window !== 'undefined' && window.Telegram?.WebApp) as any
  const init = useCallback(() => {
    if (!tg) return
    tg.ready()
    tg.expand()

    // Inherit Telegram theme colors
    const { themeParams } = tg
    const root = document.documentElement
    if (themeParams.bg_color) root.style.setProperty('--tg-bg-color', themeParams.bg_color)
    if (themeParams.text_color) root.style.setProperty('--tg-text-color', themeParams.text_color)
    if (themeParams.hint_color) root.style.setProperty('--tg-hint-color', themeParams.hint_color)
    if (themeParams.link_color) root.style.setProperty('--tg-link-color', themeParams.link_color)
    if (themeParams.button_color) root.style.setProperty('--tg-button-color', themeParams.button_color)
    if (themeParams.button_text_color) root.style.setProperty('--tg-button-text-color', themeParams.button_text_color)

    root.classList.add('tma')
  }, [tg])

  const haptic = useCallback((type: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') => {
    tg?.HapticFeedback?.impactOccurred(type)
  }, [tg])

  const success = useCallback(() => {
    tg?.HapticFeedback?.notificationOccurred('success')
  }, [tg])

  const error = useCallback(() => {
    tg?.HapticFeedback?.notificationOccurred('error')
  }, [tg])

  const setMainButton = useCallback(
    (text: string, onClick: () => void, visible = true) => {
      if (!tg) return
      tg.MainButton.text = text
      if (visible) tg.MainButton.show()
      else tg.MainButton.hide()
      tg.MainButton.onClick(onClick)
    },
    [tg]
  )

  const setBackButton = useCallback(
    (onBack: () => void, visible = true) => {
      if (!tg) return
      if (visible) tg.BackButton.show()
      else tg.BackButton.hide()
      tg.BackButton.onClick(onBack)
    },
    [tg]
  )

  const close = useCallback(() => {
    tg?.close()
  }, [tg])

  return {
    tg,
    isTMA: !!tg,
    init,
    haptic,
    success,
    error,
    setMainButton,
    setBackButton,
    close,
    user: tg?.initDataUnsafe?.user,
    themeParams: tg?.themeParams,
  }
}
