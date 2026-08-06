'use client'

import Link from 'next/link'
import { ChevronDown, LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { useState } from 'react'
import AuthModal from '@/components/auth-modal'
import ConfirmDialog from '@/components/confirm-dialog'
import { useI18n } from '@/lib/i18n'
import { useIdentity } from '@/lib/identity'
import { useTheme } from '@/lib/theme'

const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
]

/** Shared audience-site navigation bar: brand + chat identity (register/login/logout). */
export default function NavHeader() {
  const { t, lang, setLang } = useI18n()
  const { identity, loading: identityLoading, ensureIdentity, logout } = useIdentity()
  const { theme, toggleTheme } = useTheme()
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <>
      <header className='sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur'>
        <div className='mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6'>
          <Link href='/' className='flex items-center gap-2'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={theme === 'dark' ? '/logo-white.svg' : '/logo.svg'}
              alt='LingCast'
              className='size-9 rounded-xl'
            />
            <span className='text-lg font-bold tracking-tight'>
              {lang === 'zh' ? '灵播' : 'LingCast'}
            </span>
            <span className='hidden rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-muted sm:inline'>
              {t('nav.slogan')}
            </span>
          </Link>

          <div className='flex items-center gap-2'>
            <button
              onClick={toggleTheme}
              title={
                theme === 'dark' ? t('nav.switchLight') : t('nav.switchDark')
              }
              className='grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:text-foreground'
            >
              {theme === 'dark' ? (
                <Sun className='size-4' />
              ) : (
                <Moon className='size-4' />
              )}
            </button>

            <button
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              title={lang === 'zh' ? 'English' : '中文'}
              className='grid size-9 place-items-center rounded-lg border border-border bg-surface text-sm font-medium text-muted transition hover:text-foreground'
            >
              {lang === 'zh' ? 'EN' : '中'}
            </button>

            {identity ? (
              <>
                {/* 身份入口：头像 + 名字，点击展开 Profile / Logout 下拉 */}
                <div className='relative hidden sm:block'>
                  <button
                    onClick={() => setMenuOpen((o) => !o)}
                    className={`flex items-center gap-2 rounded-full border border-border px-1.5 py-1.5 pe-3 transition hover:border-foreground/40 ${
                      identity.isGuest ? 'bg-hover' : 'bg-blue-600/15'
                    }`}
                  >
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${
                        AVATAR_COLORS[Math.abs(identity.userId) % AVATAR_COLORS.length]
                      }`}
                    >
                      {identity.username.trim().slice(0, 1).toUpperCase() || '?'}
                    </span>
                    <span className='hidden max-w-28 truncate text-sm font-medium text-foreground md:block'>
                      {identity.username}
                    </span>
                    <ChevronDown
                      className={`size-3.5 text-muted transition-transform ${
                        menuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {menuOpen && (
                    <>
                      <div
                        className='fixed inset-0 z-40'
                        onClick={() => setMenuOpen(false)}
                      />
                      <div className='absolute end-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl'>
                        <Link
                          href='/account'
                          onClick={() => setMenuOpen(false)}
                          className='flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground transition hover:bg-hover'
                        >
                          <UserRound className='size-4 text-muted' />
                          {t('nav.profile')}
                          <span className='ml-auto text-[11px] text-muted'>
                            #{identity.userId}
                          </span>
                        </Link>
                        <div className='h-px bg-border' />
                        <button
                          onClick={() => {
                            setMenuOpen(false)
                            setConfirmLogout(true)
                          }}
                          className='flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-400 transition hover:bg-hover'
                        >
                          <LogOut className='size-4' />
                          {t('nav.logout')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {identity.isGuest ? (
                  <>
                    <button
                      onClick={() => setAuthMode('register')}
                      className='rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition hover:border-foreground/50'
                    >
                      {t('nav.register')}
                    </button>
                    <button
                      onClick={() => setAuthMode('login')}
                      className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500'
                    >
                      {t('nav.login')}
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <button
                onClick={() => void ensureIdentity()}
                disabled={identityLoading}
                className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40'
              >
                {identityLoading
                  ? t('nav.gettingIdentity')
                  : t('nav.getIdentity')}
              </button>
            )}
          </div>
        </div>
      </header>

      {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} />}
      <ConfirmDialog
        open={confirmLogout}
        title={t('nav.logout')}
        desc={t('nav.logoutConfirm')}
        onConfirm={() => {
          setConfirmLogout(false)
          void logout()
        }}
        onClose={() => setConfirmLogout(false)}
      />
    </>
  )
}
