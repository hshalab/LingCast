import { useEffect, useState } from 'react'
import WebApp from '@twa-dev/sdk'

// API gateway origin: relative (same-origin /api) by default, or point it at
// the ngrok api-gateway tunnel URL via VITE_API_ORIGIN (build-time env).
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? ''

type AuthResult = {
  userId: number
  username: string
  isGuest: boolean
  telegramId: number
}

type AuthState =
  | { status: 'loading' }
  | { status: 'success'; result: AuthResult }
  | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    const initData = WebApp.initData
    if (!initData) {
      setState({
        status: 'error',
        message: '未获取到 Telegram initData，请在 Telegram 内打开本应用',
      })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        })
        const body = (await res.json().catch(() => ({}))) as
          | AuthResult
          | { error?: string }
        if (!res.ok || !('userId' in body)) {
          throw new Error(
            ('error' in body && body.error) || `HTTP ${res.status}`,
          )
        }
        if (!cancelled) setState({ status: 'success', result: body })
      } catch (e) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: e instanceof Error ? e.message : '登录失败',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-zinc-100">
      <h1 className="text-2xl font-bold tracking-tight">灵播 LingCast TG</h1>

      {state.status === 'loading' && (
        <div className="flex flex-col items-center gap-2">
          <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
          <p className="text-sm text-zinc-400">正在通过 Telegram 登录…</p>
        </div>
      )}

      {state.status === 'success' && (
        <div className="w-full max-w-xs rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center">
          <p className="text-sm font-medium text-emerald-300">登录成功</p>
          <p className="mt-1 text-sm text-zinc-300">
            {state.result.username}（#{state.result.userId}）
          </p>
        </div>
      )}

      {state.status === 'error' && (
        <p className="max-w-xs text-center text-sm text-rose-400">
          {state.message}
        </p>
      )}
    </main>
  )
}
