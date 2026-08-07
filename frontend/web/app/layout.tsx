import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LingCast 1v1',
  description: '1v1 数字人聊天 · PayPal 付费体验',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  )
}
