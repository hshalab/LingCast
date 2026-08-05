'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import NavHeader from '@/components/nav-header'
import XgFlvPlayer from '@/components/xg-player'
import {
  fetchChatHistory,
  getLiveStatus,
  sendMessage,
  type ChatMessage,
} from '@/lib/api'
import { useIdentity } from '@/lib/identity'

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
  const { identity } = useIdentity()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const streamUrl = `/live/avatar_${id}.flv`

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

  return (
    <main className='flex h-dvh flex-col overflow-hidden'>
      <NavHeader />

      <div className='mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6'>
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
            <h2 className='font-medium'>互动聊天</h2>
            <p className='mt-0.5 text-xs text-zinc-500'>
              发送消息，数字人会通过 AI 回复并开口说话；退出后身份重置为新的游客。
            </p>
          </div>

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
      </div>
    </main>
  )
}
