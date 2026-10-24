'use client'

import Head from 'next/head'
import SideNav from '@/components/layout/SideNav'
import TopBar from '@/components/layout/TopBar'
import { TelegramTheme } from '@/components/layout/TelegramTheme'
import { useUIStore } from '@/lib/store'
import { usePathname } from 'next/navigation'

export default function Shell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, setSidebarOpen } = useUIStore()
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-cyber-bg text-cyber-text font-sora antialiased selection:bg-cyber-neon selection:text-cyber-bg">
      <Head>
        <title>DTD Store</title>
        <meta name="theme-color" content="#0a0a0f" />
      </Head>
      <TelegramTheme />
      <SideNav className={sidebarOpen ? '' : 'hidden'} />
      <div className={`lg:ml-64 ${typeof window !== 'undefined' && window.innerWidth < 768 ? 'relative' : ''}`}>
        <TopBar cartCount={0} />
        <main className="min-h-[calc(100vh-4rem)] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
