'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useIdentity } from '@/lib/identity'

export default function AuthModal({
  mode,
  onClose,
}: {
  mode: 'login' | 'register'
  onClose: () => void
}) {
  const { t } = useI18n()
  const { login, register } = useIdentity()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!username.trim() || !password || busy) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'register') {
        await register(username.trim(), password)
      } else {
        await login(username.trim(), password)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className='w-full max-w-sm space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-2xl'
      >
        <div className='flex items-center justify-between'>
          <h2 className='text-base font-semibold'>
            {mode === 'register' ? t('auth.registerTitle') : t('auth.loginTitle')}
          </h2>
          <button
            type='button'
            onClick={onClose}
            className='text-muted hover:text-subtle'
          >
            <X className='size-4' />
          </button>
        </div>
        <p className='text-xs leading-relaxed text-muted'>
          {mode === 'register'
            ? t('auth.registerDesc')
            : t('auth.loginDesc')}
        </p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('auth.usernamePlaceholder')}
          autoFocus
          className='w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-foreground/50'
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.passwordPlaceholder')}
          type='password'
          className='w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-foreground/50'
        />
        {error && <p className='text-xs text-red-400'>{error}</p>}
        <button
          type='submit'
          disabled={busy || !username.trim() || !password}
          className='w-full rounded-xl bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40'
        >
          {busy
            ? t('auth.busy')
            : mode === 'register'
              ? t('auth.register')
              : t('auth.login')}
        </button>
      </form>
    </div>
  )
}
