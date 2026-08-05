'use client'

import Link from 'next/link'
import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import AuthModal from '@/components/auth-modal'
import { useIdentity } from '@/lib/identity'
import { useTheme } from '@/lib/theme'

/** Shared audience-site navigation bar: brand + chat identity (register/login/logout). */
export default function NavHeader() {
  const { identity, loading: identityLoading, ensureIdentity, logout } = useIdentity()
  const { theme, toggleTheme } = useTheme()
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  return (
    <>
      <header className='sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur'>
        <div className='mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6'>
          <Link href='/' className='flex items-center gap-2'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={theme === 'dark' ? '/logo-white.svg' : '/logo.svg'}
              alt='灵播'
              className='size-9 rounded-xl'
            />
            <span className='text-lg font-bold tracking-tight'>灵播</span>
            <span className='hidden rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-muted sm:inline'>
              数字人直播
            </span>
          </Link>

          <div className='flex items-center gap-2'>
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
              className='grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:text-foreground'
            >
              {theme === 'dark' ? (
                <Sun className='size-4' />
              ) : (
                <Moon className='size-4' />
              )}
            </button>

            {identity ? (
              <>
                <span
                  className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs sm:flex ${
                    identity.isGuest
                      ? 'bg-muted/80 text-subtle'
                      : 'bg-blue-600/20 text-blue-300'
                  }`}
                >
                  <span>{identity.isGuest ? '游客' : '账号'}</span>
                  <span className='font-medium'>{identity.username}</span>
                  <span className='opacity-60'>#{identity.userId}</span>
                </span>
                {identity.isGuest ? (
                  <>
                    <button
                      onClick={() => setAuthMode('register')}
                      className='rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition hover:border-foreground/50'
                    >
                      注册
                    </button>
                    <button
                      onClick={() => setAuthMode('login')}
                      className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500'
                    >
                      登录
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void logout()}
                    className='rounded-lg border border-border px-3 py-1.5 text-sm text-subtle transition hover:border-foreground/50'
                  >
                    退出
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => void ensureIdentity()}
                disabled={identityLoading}
                className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40'
              >
                {identityLoading ? '获取身份中…' : '获取游客身份'}
              </button>
            )}
          </div>
        </div>
      </header>

      {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} />}
    </>
  )
}
