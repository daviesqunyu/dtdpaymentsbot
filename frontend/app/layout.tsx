import '@/app/globals.css'

export const metadata = {
  title: 'DTD Store',
  description: 'Premium digital products store with Paystack, USDT TRC20, and Bitcoin payments.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-cyber-bg text-cyber-text">{children}</body>
    </html>
  )
}
