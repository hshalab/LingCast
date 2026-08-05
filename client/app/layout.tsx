import type { Metadata } from 'next'
import { IdentityProvider } from '@/lib/identity'
import './globals.css'

export const metadata: Metadata = {
  title: '数字人直播间',
  description: '观看数字人直播，并与 TA 实时互动',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang='zh-CN'>
      <body className='min-h-screen antialiased'>
        <IdentityProvider>{children}</IdentityProvider>
      </body>
    </html>
  )
}
