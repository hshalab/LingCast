'use client'

import { useState } from 'react'
import { useIdentity } from '@/lib/identity'

export default function AuthModal({
  mode,
  onClose,
}: {
  mode: 'login' | 'register'
  onClose: () => void
}) {
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
      setError(e instanceof Error ? e.message : '操作失败')
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
        className='w-full max-w-sm space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl'
      >
        <div className='flex items-center justify-between'>
          <h2 className='text-base font-semibold'>
            {mode === 'register' ? '注册账号' : '登录账号'}
          </h2>
          <button
            type='button'
            onClick={onClose}
            className='text-zinc-500 hover:text-zinc-300'
          >
            ✕
          </button>
        </div>
        <p className='text-xs leading-relaxed text-zinc-500'>
          {mode === 'register'
            ? '注册后当前身份的聊天记录将保留并绑定到该账号。'
            : '登录后当前身份的聊天记录会合并进该账号，不会丢失。'}
        </p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder='用户名'
          autoFocus
          className='w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-sm outline-none focus:border-zinc-500'
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder='密码（至少 4 位）'
          type='password'
          className='w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-sm outline-none focus:border-zinc-500'
        />
        {error && <p className='text-xs text-red-400'>{error}</p>}
        <button
          type='submit'
          disabled={busy || !username.trim() || !password}
          className='w-full rounded-xl bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40'
        >
          {busy ? '处理中…' : mode === 'register' ? '注册' : '登录'}
        </button>
      </form>
    </div>
  )
}
