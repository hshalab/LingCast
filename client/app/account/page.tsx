'use client'

import Link from 'next/link'
import { LogOut, MessageCircle, Sparkles, UserRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import AuthModal from '@/components/auth-modal'
import ConfirmDialog from '@/components/confirm-dialog'
import NavHeader from '@/components/nav-header'
import { fetchMyHistory, type ChatMessage } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useIdentity } from '@/lib/identity'

const COLORS = [
  'bg-blue-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
]

function timeLabel(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale, { hour12: false })
  } catch {
    return ''
  }
}

export default function AccountPage() {
  const { t, locale } = useI18n()
  const { identity, loading, logout } = useIdentity()
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [msgLoading, setMsgLoading] = useState(false)

  const loadMessages = useCallback(async () => {
    if (!identity) return
    setMsgLoading(true)
    try {
      const { data } = await fetchMyHistory(identity.userId)
      setMessages(data.slice().reverse())
    } catch {
      // keep previous state
    } finally {
      setMsgLoading(false)
    }
  }, [identity])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  if (loading) {
    return (
      <div className='flex min-h-screen flex-col bg-background'>
        <NavHeader />
        <main className='flex flex-1 items-center justify-center text-sm text-muted'>
          {t('common.loading')}
        </main>
      </div>
    )
  }

  if (!identity) {
    return (
      <div className='flex min-h-screen flex-col bg-background'>
        <NavHeader />
        <main className='flex flex-1 items-center justify-center'>
          <p className='text-sm text-muted'>{t('identity.notReady')}</p>
        </main>
      </div>
    )
  }

  const color = COLORS[Math.abs(identity.userId) % COLORS.length]
  const initial = identity.username.trim().slice(0, 1).toUpperCase() || '?'

  return (
    <div className='flex min-h-screen flex-col bg-background'>
      <NavHeader />

      <main className='mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6'>
        {/* Identity card */}
        <section className='overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-blue-600/15 via-surface to-violet-600/15 p-6 sm:p-8'>
          <div className='flex flex-wrap items-center gap-5'>
            <div
              className={`grid size-20 shrink-0 place-items-center rounded-full text-3xl font-bold text-white ${color}`}
            >
              {initial}
            </div>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <h1 className='text-2xl font-bold tracking-tight text-foreground'>
                  {identity.username}
                </h1>
                <span className='rounded-full bg-white/10 px-2 py-0.5 text-xs text-subtle'>
                  #{identity.userId}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    identity.isGuest
                      ? 'bg-muted/80 text-subtle'
                      : 'bg-blue-600/20 text-blue-300'
                  }`}
                >
                  {identity.isGuest
                    ? t('account.guestBadge')
                    : t('account.accountBadge')}
                </span>
              </div>
              <p className='mt-1.5 text-sm text-muted'>
                {identity.isGuest
                  ? t('account.guestDesc')
                  : t('account.accountDesc')}
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {identity.isGuest ? (
                <>
                  <button
                    onClick={() => setAuthMode('register')}
                    className='rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500'
                  >
                    {t('account.register')}
                  </button>
                  <button
                    onClick={() => setAuthMode('login')}
                    className='rounded-xl border border-border px-4 py-2 text-sm text-foreground transition hover:border-foreground/50'
                  >
                    {t('account.login')}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmLogout(true)}
                  className='flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm text-subtle transition hover:border-foreground/50 hover:text-foreground'
                >
                  <LogOut className='size-4' />
                  {t('account.logout')}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* My messages */}
        <section className='flex flex-col gap-3 rounded-3xl border border-border bg-surface/50 p-5 sm:p-6'>
          <h2 className='flex items-center gap-2 font-semibold text-foreground'>
            <MessageCircle className='size-5 text-blue-400' />
            {t('account.myMessages')}
            <span className='text-xs font-normal text-muted'>
              {messages.length > 0 ? `(${messages.length})` : ''}
            </span>
          </h2>

          {msgLoading ? (
            <p className='py-6 text-center text-sm text-muted'>
              {t('common.loading')}
            </p>
          ) : messages.length === 0 ? (
            <div className='flex flex-col items-center gap-2 py-8 text-center text-muted'>
              <Sparkles className='size-8 text-faint' />
              <p className='text-sm'>{t('account.noMessages')}</p>
              <Link
                href='/'
                className='mt-1 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110'
              >
                {t('account.goHome')}
              </Link>
            </div>
          ) : (
            <ul className='flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1'>
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === 'bot'
                      ? 'border border-violet-500/20 bg-violet-500/10 text-foreground'
                      : 'bg-gradient-to-br from-blue-600 to-violet-600 text-white'
                  }`}
                >
                  <p className='mb-0.5 flex items-center gap-2 text-[11px] opacity-75'>
                    {m.role === 'bot' ? '🤖' : <UserRound className='size-3' />}
                    {m.role === 'bot' ? m.username : m.username}
                    <span className='ml-auto'>
                      {timeLabel(m.createdAt, locale)}
                    </span>
                  </p>
                  <p className='whitespace-pre-wrap'>{m.content}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} />}
      <ConfirmDialog
        open={confirmLogout}
        title={t('account.logout')}
        desc={t('nav.logoutConfirm')}
        onConfirm={() => {
          setConfirmLogout(false)
          void logout()
        }}
        onClose={() => setConfirmLogout(false)}
      />
    </div>
  )
}
