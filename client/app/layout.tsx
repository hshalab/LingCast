import type { Metadata } from 'next'
import { I18nProvider } from '@/lib/i18n'
import { IdentityProvider } from '@/lib/identity'
import { ThemeProvider } from '@/lib/theme'
import './globals.css'

export const metadata: Metadata = {
  title: '灵播 LingCast',
  description: 'AI 数字人直播平台：观看数字人直播，并与 TA 实时互动',
  icons: {
    icon: '/logo.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang='zh-CN'>
      <body className='min-h-screen antialiased'>
        <ThemeProvider>
          <I18nProvider>
            <IdentityProvider>{children}</IdentityProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
