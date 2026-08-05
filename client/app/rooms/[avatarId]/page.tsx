'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import XgFlvPlayer from '@/components/xg-player'
import {
  createGuestIdentity,
  fetchChatHistory,
  getLiveStatus,
  loginIdentity,
  registerIdentity,
  sendMessage,
  type ChatIdentity,
  type ChatMessage,
} from '@/lib/api'

const IDENTITY_KEY = 'tav_chat_identity'

function loadIdentity(): ChatIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    return raw ? (JSON.parse(raw) as ChatIdentity) : null
  } catch {
    return null
  }
}

function saveIdentity(identity: ChatIdentity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
}

function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY)
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function RoomPage() {
  const { avatarId } = useParams<{ avatarId: string }>()
  const id = Number(avatarId)
  const [started, setStarted] = useState(false)
  const [identity, setIdentity] = useState<ChatIdentity | null>(null)
  const [identityLoading, setIdentityLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)
  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const streamUrl = `/live/avatar_${id}.flv`

  // Viewer identity: restore from localStorage, otherwise create a guest.
  const ensureIdentity = useCallback(async () => {
    const cached = loadIdentity()
    if (cached) {
      setIdentity(cached)
      return cached
    }
    setIdentityLoading(true)
    try {
      const guest = await createGuestIdentity()
      saveIdentity(guest)
      setIdentity(guest)
      return guest
    } catch {
      setIdentity(null)
      return null
    } finally {
      setIdentityLoading(false)
    }
  }, [])

  useEffect(() => {
    void ensureIdentity()
  }, [ensureIdentity])

  // Poll the session status; the player mounts once the stream is live.
  useEffect(() => {
    if (!id) return
    let stopped = false
    const poll = async () => {
      try {
        await getLiveStatus(id)
        if (!stopped) setStarted(true)
      } catch {
        if (!stopped) setStarted(false)
      }
    }
    void poll()
    const timer = window.setInterval(poll, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [id])

  // Persisted room history: load once and refresh every 3s (catches replies
  // from other viewers too).
  const refreshHistory = useCallback(async () => {
    if (!id) return
    try {
      const { data } = await fetchChatHistory(id)
      setMessages(data)
    } catch {
      // keep previous state
    }
  }, [id])

  useEffect(() => {
    void refreshHistory()
    const timer = window.setInterval(refreshHistory, 3000)
    return () => window.clearInterval(timer)
  }, [refreshHistory])

  // Keep the chat scrolled to the latest message.
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || sending || !id || !identity) return
    setSending(true)
    try {
      await sendMessage(id, text, identity)
      setInput('')
      await refreshHistory()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '发送失败'
      setInput('')
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now(),
          avatarId: id,
          userId: identity.userId,
          username: identity.username,
          role: 'user',
          content: text,
          createdAt: new Date().toISOString(),
        },
        {
          id: -Date.now() - 1,
          avatarId: id,
          userId: 0,
          username: '系统',
          role: 'bot',
          content: `⚠️ ${msg}`,
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  const submitAuth = async () => {
    const username = authUser.trim()
    if (!username || !authPass || !identity || !authMode) return
    setAuthBusy(true)
    setAuthError('')
    try {
      const next =
        authMode === 'register'
          ? await registerIdentity(identity.userId, username, authPass)
          : await loginIdentity(identity.userId, username, authPass)
      saveIdentity(next)
      setIdentity(next)
      setAuthMode(null)
      setAuthUser('')
      setAuthPass('')
      await refreshHistory()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '操作失败')
    } finally {
      setAuthBusy(false)
    }
  }

  const logout = async () => {
    clearIdentity()
    setIdentity(null)
    await ensureIdentity()
  }

  return (
    <main className='mx-auto flex h-dvh w-full max-w-6xl flex-col overflow-hidden px-4 py-4 sm:px-6'>
      <header className='mb-3 flex shrink-0 flex-wrap items-center gap-3'>
        <Link
          href='/'
          className='rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600'
        >
          ← 返回列表
        </Link>
        <div>
          <h1 className='text-lg font-bold'>直播间 #{id}</h1>
          <p className='text-xs text-zinc-500'>
            拉流地址：
            <code className='ml-1 break-all text-zinc-400'>{streamUrl}</code>
          </p>
        </div>
        <span
          className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            started
              ? 'bg-red-600 text-white'
              : 'border border-zinc-700 text-zinc-400'
          }`}
        >
          {started ? '● 直播中' : '未开播'}
        </span>
      </header>

      {/* 左右结构：桌面端画面在左、聊天在右，整页 100% 视口高，内容超高时各区域内部滚动 */}
      <div className='flex min-h-0 flex-1 flex-col gap-3 lg:flex-row'>
        <div className='flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-2xl border border-zinc-800 bg-black p-2 sm:p-3'>
          {started ? (
            <XgFlvPlayer
              url={streamUrl}
              className='aspect-[9/16] w-full max-w-[420px] overflow-hidden rounded-xl lg:h-full lg:w-auto lg:max-w-full'
            />
          ) : (
            <div className='flex aspect-[9/16] w-full max-w-[420px] flex-col items-center justify-center gap-2 text-sm text-zinc-500 lg:h-full lg:w-auto lg:max-w-full'>
              <span className='text-4xl'>📺</span>
              主播暂未开播，请稍候…
            </div>
          )}
        </div>

        <section className='flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 lg:h-full lg:w-[380px]'>
          <div className='shrink-0 border-b border-zinc-800 px-4 py-3'>
            <div className='flex items-center justify-between gap-2'>
              <h2 className='font-medium'>互动聊天</h2>
              {identity ? (
                <span className='flex items-center gap-1.5 text-xs text-zinc-400'>
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      identity.isGuest ? 'bg-zinc-800 text-zinc-400' : 'bg-blue-600/20 text-blue-300'
                    }`}
                  >
                    {identity.isGuest ? '游客' : '账号'}
                  </span>
                  <span className='font-medium text-zinc-300'>{identity.username}</span>
                  <span className='text-zinc-600'>#{identity.userId}</span>
                  {identity.isGuest ? (
                    <>
                      <button
                        onClick={() => setAuthMode(authMode === 'register' ? null : 'register')}
                        className='text-blue-400 hover:text-blue-300'
                      >
                        注册
                      </button>
                      <button
                        onClick={() => setAuthMode(authMode === 'login' ? null : 'login')}
                        className='text-blue-400 hover:text-blue-300'
                      >
                        登录
                      </button>
                    </>
                  ) : (
                    <button onClick={() => void logout()} className='text-zinc-500 hover:text-zinc-300'>
                      退出
                    </button>
                  )}
                </span>
              ) : (
                <button
                  onClick={() => void ensureIdentity()}
                  disabled={identityLoading}
                  className='text-xs text-blue-400 hover:text-blue-300'
                >
                  {identityLoading ? '获取身份中…' : '获取游客身份'}
                </button>
              )}
            </div>
            <p className='mt-0.5 text-xs text-zinc-500'>
              发送消息，数字人会通过 AI 回复并开口说话；退出后身份重置为新的游客。
            </p>
          </div>

          {authMode && identity ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submitAuth()
              }}
              className='shrink-0 space-y-2 border-b border-zinc-800 bg-zinc-950/40 p-3'
            >
              <div className='flex items-center justify-between'>
                <p className='text-sm font-medium text-zinc-300'>
                  {authMode === 'register' ? '注册账号' : '登录账号'}
                </p>
                <button
                  type='button'
                  onClick={() => {
                    setAuthMode(null)
                    setAuthError('')
                  }}
                  className='text-xs text-zinc-500 hover:text-zinc-300'
                >
                  取消
                </button>
              </div>
              <input
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
                placeholder='用户名'
                autoFocus
                className='w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-zinc-500'
              />
              <input
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                placeholder='密码（至少 4 位）'
                type='password'
                className='w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-zinc-500'
              />
              {authError && <p className='text-xs text-red-400'>{authError}</p>}
              <button
                type='submit'
                disabled={authBusy || !authUser.trim() || !authPass}
                className='w-full rounded-lg bg-blue-600 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40'
              >
                {authBusy ? '处理中…' : authMode === 'register' ? '注册并绑定当前身份' : '登录并合并聊天记录'}
              </button>
            </form>
          ) : null}

          <div ref={chatRef} className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
            {messages.length === 0 ? (
              <p className='py-10 text-center text-sm text-zinc-500'>
                还没有消息，说点什么吧
              </p>
            ) : (
              <div className='flex flex-col gap-3'>
                {messages.map((m) =>
                  m.role === 'bot' ? (
                    <div key={m.id} className='self-start max-w-[88%]'>
                      <p className='mb-0.5 text-[11px] text-zinc-500'>
                        🤖 {m.username} · {formatTime(m.createdAt)}
                      </p>
                      <div className='rounded-2xl rounded-bl-sm bg-zinc-800 px-3.5 py-2 text-sm leading-relaxed text-zinc-100'>
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className='self-end max-w-[88%]'>
                      <p className='mb-0.5 text-right text-[11px] text-zinc-500'>
                        {m.username} <span className='text-zinc-600'>#{m.userId}</span> ·{' '}
                        {formatTime(m.createdAt)}
                      </p>
                      <div className='rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2 text-sm leading-relaxed text-white'>
                        {m.content}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <div className='flex shrink-0 gap-2 border-t border-zinc-800 p-3'>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder={identity ? '发条消息…' : '获取身份后即可发言'}
              disabled={!started || !identity || sending}
              className='min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-sm outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50'
            />
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim() || !started || !identity}
              className='shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40'
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
