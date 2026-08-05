'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Bot, Heart, Tv } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import NavHeader from '@/components/nav-header'
import XgFlvPlayer from '@/components/xg-player'
import {
  fetchAvatar,
  fetchChatHistory,
  getLiveStatus,
  sendMessage,
  type Avatar,
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

const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
]

const QUICK_PHRASES = ['欢迎', '在吗', '哈哈', '666', '谢谢', '晚安']

export default function RoomPage() {
  const { avatarId } = useParams<{ avatarId: string }>()
  const id = Number(avatarId)
  const [started, setStarted] = useState(false)
  const { identity } = useIdentity()
  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [likes, setLikes] = useState(0)
  const [hearts, setHearts] = useState<{ id: number; x: number }[]>([])
  const [hasNew, setHasNew] = useState(false)
  const likeId = useRef(0)
  const stickRef = useRef(true)
  const chatRef = useRef<HTMLDivElement>(null)
  const streamUrl = `/live/avatar_${id}.flv`

  const colorFor = (uid: number) => AVATAR_COLORS[Math.abs(uid) % AVATAR_COLORS.length]
  const initialFor = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?'
  const like = () => {
    const hid = ++likeId.current
    const x = 15 + Math.random() * 70
    setLikes((n) => n + 1)
    setHearts((h) => [...h, { id: hid, x }])
    window.setTimeout(() => setHearts((h) => h.filter((v) => v.id !== hid)), 1200)
  }

  // Avatar profile for the details panel.
  useEffect(() => {
    if (!id) return
    fetchAvatar(id)
      .then(setAvatar)
      .catch(() => setAvatar(null))
  }, [id])

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

  // Persisted room history: load once and refresh every 3s.
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

  // Chat scroll: only auto-scroll when the viewer is at the bottom. If they
  // scrolled up to read history, new messages show a "有新消息" button instead
  // of yanking the scroll position.
  const onChatScroll = () => {
    const el = chatRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    stickRef.current = nearBottom
    if (nearBottom) setHasNew(false)
  }

  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    if (stickRef.current) {
      el.scrollTo({ top: el.scrollHeight })
    } else if (messages.length > 0) {
      setHasNew(true)
    }
  }, [messages])

  const scrollToLatest = () => {
    stickRef.current = true
    setHasNew(false)
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }

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
          content: `[发送失败] ${msg}`,
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <main className='flex h-dvh flex-col overflow-hidden bg-zinc-950'>
      {/* 桌面端导航（手机端全屏隐藏） */}
      <div className='hidden lg:block'>
        <NavHeader />
      </div>

      <div className='mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-0 py-0 lg:px-4 lg:py-4'>
        {/* 标题行（仅桌面端；手机端覆盖到画面上） */}
        <div className='mb-3 hidden shrink-0 flex-wrap items-start justify-between gap-3 lg:flex'>
          <div className='flex shrink-0 items-center gap-3'>
            <Link
              href='/'
              className='shrink-0 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600'
            >
              ← 返回列表
            </Link>
            <div className='min-w-0 shrink-0'>
              <h1 className='flex items-center gap-2 text-lg font-bold text-zinc-100'>
                直播间
                <span className='rounded-md bg-gradient-to-r from-blue-600 to-violet-600 px-1.5 py-0.5 text-xs font-semibold text-white'>
                  #{id}
                </span>
              </h1>
            </div>
          </div>

          {/* 数字人详情：靠右的纵向资料卡 */}
          {avatar && (
            <div className='ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs backdrop-blur'>
              <span className='whitespace-nowrap font-semibold text-white'>
                {avatar.name} <span className='text-zinc-500'>#{avatar.id}</span>
              </span>
              {avatar.category && (
                <span className='whitespace-nowrap rounded-md bg-white/5 px-1.5 py-0.5 text-zinc-300'>
                  {avatar.category}
                </span>
              )}
              {avatar.age != null && (
                <span className='whitespace-nowrap text-zinc-400'>年龄 {avatar.age}岁</span>
              )}
              {avatar.heightCm != null && (
                <span className='whitespace-nowrap text-zinc-400'>身高 {avatar.heightCm}cm</span>
              )}
              {avatar.weightKg != null && (
                <span className='whitespace-nowrap text-zinc-400'>体重 {avatar.weightKg}kg</span>
              )}
              {avatar.ethnicity && (
                <span className='whitespace-nowrap text-zinc-400'>族裔 {avatar.ethnicity}</span>
              )}
              {avatar.relationshipStatus && (
                <span className='whitespace-nowrap text-zinc-400'>
                  感情 {avatar.relationshipStatus}
                </span>
              )}
              {avatar.personality && (
                <span className='whitespace-nowrap text-zinc-400'>性格 {avatar.personality}</span>
              )}
            </div>
          )}
        </div>

        {/* 抖音直播式布局：左画面铺满 + 模糊背景，右聊天固定 400 */}
        <div className='flex min-h-0 flex-1 flex-col gap-3 lg:flex-row'>
          {/* 左：画面区铺满，9:16 视频居中、高度撑满，两侧模糊背景 */}
          <div className='relative min-h-0 flex-1 overflow-hidden rounded-none border-0 bg-zinc-950 lg:rounded-3xl lg:border lg:border-zinc-800'>
            {/* 模糊背景层（根据画面） */}
            {avatar?.imageS3Url && (
              <img
                src={avatar.imageS3Url}
                alt=''
                aria-hidden
                className='absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl'
              />
            )}
            <div className='absolute inset-0 bg-gradient-to-b from-zinc-950/50 via-transparent to-black/60' />

            {/* 视频居中、高度撑满 */}
            <div className='relative z-10 flex h-full w-full items-center justify-center overflow-hidden'>
              <div className='relative h-full shrink-0'>
                {started ? (
                  <XgFlvPlayer
                    url={streamUrl}
                    className='aspect-[9/16] h-full max-h-full w-auto max-w-full overflow-hidden'
                  />
                ) : (
                  <div className='flex aspect-[9/16] h-full flex-col items-center justify-center gap-2 text-sm text-zinc-400'>
                    <Tv className='size-10 text-zinc-500' />
                    主播暂未开播，请稍候…
                  </div>
                )}

                {/* 直播间徽标 */}
                {started && (
                  <span className='absolute right-2 top-2 flex items-center gap-1 rounded-full bg-gradient-to-r from-red-600 to-red-500 px-2 py-0.5 text-xs font-medium text-white shadow-lg shadow-red-600/30 lg:left-2 lg:right-auto lg:top-2'>
                    <span className='size-1.5 animate-pulse rounded-full bg-white' />
                    直播中
                  </span>
                )}

                {/* 点赞爱心动画 */}
                <div className='pointer-events-none absolute inset-0 overflow-hidden'>
                  {hearts.map((h) => (
                    <span
                      key={h.id}
                      className='absolute bottom-20 animate-[float-up_1.2s_ease-out_forwards] text-2xl'
                      style={{ right: `${h.x}%` }}
                    >
                      <Heart className='size-5 fill-rose-500 text-rose-500 drop-shadow' />
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 点赞按钮 */}
            <button
              onClick={like}
              className='absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-4 py-2 text-sm text-zinc-200 backdrop-blur transition hover:border-rose-500 hover:text-rose-400 lg:flex'
            >
              <Heart
                className={`size-4 ${likes > 0 ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'}`}
              />
              {likes > 0 ? likes : '点赞'}
            </button>

            {/* 手机端顶部覆盖：返回 + 主播头像/名字 */}
            <div className='absolute inset-x-0 top-0 z-30 flex items-start gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 lg:hidden'>
              <Link
                href='/'
                className='grid size-9 shrink-0 place-items-center rounded-full bg-black/50 text-white backdrop-blur'
              >
                <ArrowLeft className='size-5' />
              </Link>
              {avatar && (
                <div className='flex min-w-0 items-center gap-2'>
                  {avatar.imageS3Url && (
                    <img
                      src={avatar.imageS3Url}
                      alt={avatar.name}
                      className='size-9 shrink-0 rounded-full border border-white/20 object-cover'
                    />
                  )}
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-semibold text-white'>
                      {avatar.name}
                    </p>
                    <p className='text-[11px] text-white/70'>直播间 #{id}</p>
                  </div>
                </div>
              )}
            </div>

            {/* 移动端（抖音式）：胶囊消息 + 覆盖式输入 */}
            <div className='absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-3 pb-3 lg:hidden'>
              <div className='pointer-events-none flex flex-col items-start gap-1.5'>
                {messages.slice(-3).map((m) => (
                  <span
                    key={m.id}
                    className='max-w-[85%] truncate rounded-full bg-black/55 px-3 py-1.5 text-xs text-white/95 backdrop-blur'
                  >
                    <span
                      className={
                        m.role === 'bot' ? 'text-violet-300' : 'text-blue-300'
                      }
                    >
                      {m.username}：
                    </span>
                    {m.content}
                  </span>
                ))}
              </div>
              <div className='flex items-center gap-2'>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void send()}
                  placeholder={identity ? '发条消息…' : '获取身份后即可发言'}
                  disabled={!started || !identity || sending}
                  className='min-w-0 flex-1 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-sm text-white outline-none backdrop-blur transition placeholder:text-zinc-400 focus:border-blue-500 disabled:opacity-50'
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !input.trim() || !started || !identity}
                  className='shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-600/25 transition hover:brightness-110 disabled:opacity-40'
                >
                  {sending ? '发送中…' : '发送'}
                </button>
              </div>
            </div>
          </div>

          {/* 右：聊天面板，固定 400 宽 */}
          <section className='hidden min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/70 backdrop-blur lg:flex lg:w-[400px]'>
            <div className='flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3'>
              <div>
                <h2 className='font-semibold text-zinc-100'>互动聊天</h2>
                <p className='mt-0.5 text-xs text-zinc-500'>
                  数字人通过 AI 回复并开口说话
                </p>
              </div>
            </div>

            <div
              ref={chatRef}
              onScroll={onChatScroll}
              className='relative min-h-0 flex-1 overflow-y-auto px-3 py-3'
            >
              {hasNew && (
                <button
                  onClick={scrollToLatest}
                  className='absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 shadow-lg transition hover:border-blue-500 hover:text-blue-300'
                >
                  有新消息
                </button>
              )}
              {messages.length === 0 ? (
                <p className='py-10 text-center text-sm text-zinc-500'>
                  还没有消息，说点什么吧
                </p>
              ) : (
                <div className='flex flex-col gap-3'>
                  {messages.map((m) => (
                    <div key={m.id} className='flex items-start gap-2'>
                      {m.role === 'bot' ? (
                        avatar?.imageS3Url ? (
                          <img
                            src={avatar.imageS3Url}
                            alt={avatar.name}
                            className='size-7 shrink-0 rounded-full border border-zinc-700 object-cover'
                          />
                        ) : (
                          <span
                            className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${colorFor(m.userId)}`}
                          >
                            <Bot className='size-4' />
                          </span>
                        )
                      ) : (
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${colorFor(m.userId)}`}
                        >
                          {initialFor(m.username)}
                        </span>
                      )}
                      <div className='min-w-0 max-w-[88%]'>
                        <p className='text-[11px] text-zinc-500'>
                          <span
                            className={
                              m.role === 'bot'
                                ? 'font-medium text-violet-300'
                                : 'font-medium text-blue-300'
                            }
                          >
                            {m.username}
                          </span>
                          <span className='ml-1 text-zinc-600'>
                            #{m.userId} · {formatTime(m.createdAt)}
                          </span>
                        </p>
                        <div
                          className={`mt-0.5 rounded-2xl rounded-tl-sm px-3.5 py-2 text-sm leading-relaxed ${
                            m.role === 'bot'
                              ? 'bg-gradient-to-br from-violet-600/25 to-blue-600/15 text-zinc-100'
                              : 'bg-zinc-800/80 text-zinc-100'
                          }`}
                        >
                          {m.content}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 快捷表情 + 输入栏 */}
            <div className='shrink-0 border-t border-zinc-800 p-3'>
              <div className='mb-2 flex items-center gap-1'>
                {QUICK_PHRASES.map((p) => (
                  <button
                    key={p}
                    onClick={() => setInput((v) => v + p)}
                    className='rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200'
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className='flex items-center gap-2'>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void send()}
                  placeholder={identity ? '发条消息…' : '获取身份后即可发言'}
                  disabled={!started || !identity || sending}
                  className='min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm outline-none transition placeholder:text-zinc-600 focus:border-blue-500 disabled:opacity-50'
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !input.trim() || !started || !identity}
                  className='shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-blue-600/25 transition hover:brightness-110 disabled:opacity-40'
                >
                  {sending ? '发送中…' : '发送'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
