'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import XgFlvPlayer from '@/components/xg-player'
import { getLiveStatus, sendMessage } from '@/lib/api'

type ChatMessage = { role: 'user' | 'bot'; text: string }

export default function RoomPage() {
  const { avatarId } = useParams<{ avatarId: string }>()
  const id = Number(avatarId)
  const [started, setStarted] = useState(false)
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

  // Keep the chat scrolled to the latest message.
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || sending || !id) return
    setSending(true)
    setMessages((prev) => [...prev, { role: 'user', text }])
    try {
      const data = await sendMessage(id, text)
      setInput('')
      if (data.reply) {
        setMessages((prev) => [...prev, { role: 'bot', text: data.reply }])
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '发送失败'
      setMessages((prev) => [...prev, { role: 'bot', text: `⚠️ ${msg}` }])
    } finally {
      setSending(false)
    }
  }

  return (
    <main className='mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6'>
      <header className='mb-4 flex items-center gap-3'>
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

      {/* 左右结构：桌面端画面在左、聊天在右，两边同时可见，无需滚动 */}
      <div className='flex flex-col gap-4 lg:flex-row lg:items-stretch'>
        <div className='flex flex-1 justify-center rounded-2xl border border-zinc-800 bg-black p-3'>
          {started ? (
            <XgFlvPlayer
              url={streamUrl}
              className='aspect-[9/16] w-full max-w-[420px] overflow-hidden rounded-xl'
            />
          ) : (
            <div className='flex aspect-[9/16] w-full max-w-[420px] flex-col items-center justify-center gap-2 text-sm text-zinc-500'>
              <span className='text-4xl'>📺</span>
              主播暂未开播，请稍候…
            </div>
          )}
        </div>

        <section className='flex w-full flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50 lg:w-[380px] lg:shrink-0'>
          <div className='border-b border-zinc-800 px-4 py-3'>
            <h2 className='font-medium'>互动聊天</h2>
            <p className='text-xs text-zinc-500'>
              发送消息，数字人会通过 AI 回复并开口说话。
            </p>
          </div>

          <div
            ref={chatRef}
            className='flex min-h-56 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3'
          >
            {messages.length === 0 ? (
              <p className='py-10 text-center text-sm text-zinc-500'>
                还没有消息，说点什么吧
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'self-end rounded-br-sm bg-blue-600 text-white'
                      : 'self-start rounded-bl-sm bg-zinc-800 text-zinc-100'
                  }`}
                >
                  {m.text}
                </div>
              ))
            )}
          </div>

          <div className='flex gap-2 border-t border-zinc-800 p-3'>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder='发条消息…'
              disabled={!started}
              className='min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-sm outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50'
            />
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim() || !started}
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
