'use client'

import Link from 'next/link'
import {
  BookOpen,
  Clapperboard,
  Compass,
  Flame,
  Gamepad2,
  MessageCircle,
  Mic,
  Palette,
  Radio,
  ShoppingCart,
  Sparkles,
  Tv,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import NavHeader from '@/components/nav-header'
import { listLiveSessions, type LiveSessionItem } from '@/lib/api'

const CATEGORIES: { key: string; label: string; icon: typeof Compass }[] = [
  { key: '全部', label: '全部', icon: Compass },
  { key: '闲聊', label: '闲聊', icon: MessageCircle },
  { key: '知识', label: '知识', icon: BookOpen },
  { key: '娱乐', label: '娱乐', icon: Mic },
  { key: '游戏', label: '游戏', icon: Gamepad2 },
  { key: '带货', label: '带货', icon: ShoppingCart },
  { key: '其他', label: '其他', icon: Sparkles },
]

export default function Home() {
  const [sessions, setSessions] = useState<LiveSessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('全部')

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const { data } = await listLiveSessions()
        if (!stopped) setSessions(data)
      } catch {
        // keep previous state
      } finally {
        if (!stopped) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(load, 3000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  const availableCategories = useMemo(() => {
    const present = new Set(sessions.map((s) => s.category || '其他'))
    return CATEGORIES.filter((c) => c.key === '全部' || present.has(c.key))
  }, [sessions])

  const filtered =
    category === '全部'
      ? sessions
      : sessions.filter((s) => (s.category || '其他') === category)

  return (
    <div className='flex min-h-screen flex-col bg-zinc-950'>
      <NavHeader />

      <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6'>
        {/* Hero 横幅 */}
        <section className='relative mb-6 overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-blue-600/25 via-zinc-900 to-violet-600/20 p-6 sm:p-8'>
          <div className='pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-blue-500/20 blur-3xl' />
          <div className='pointer-events-none absolute -bottom-20 -left-10 size-64 rounded-full bg-violet-500/20 blur-3xl' />
          <div className='relative z-10'>
            <h1 className='text-2xl font-bold tracking-tight sm:text-3xl'>
              正在开播
              <Flame className='ml-2 inline size-6 text-orange-400' />
            </h1>
            <p className='mt-2 max-w-md text-sm text-zinc-400'>
              进入房间观看直播、发消息互动，数字人会通过 AI 实时回复你。
            </p>
            <div className='mt-4 flex flex-wrap gap-2 text-xs'>
              <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300 backdrop-blur'>
                <Tv className='mr-1 inline size-3.5' />
                开播中 {sessions.length} 个
              </span>
              <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300 backdrop-blur'>
                <Palette className='mr-1 inline size-3.5' />
                分类 {Math.max(availableCategories.length - 1, 0)} 种
              </span>
            </div>
          </div>
        </section>

        {/* 分类筛选 */}
        <div className='mb-5 flex flex-wrap items-center gap-2'>
          {availableCategories.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                category === c.key
                  ? 'bg-gradient-to-r from-blue-600 to-violet-600 font-medium text-white shadow-lg shadow-blue-600/25'
                  : 'border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
              }`}
            >
              <c.icon className='mr-1.5 inline size-4' />
              {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className='aspect-[9/16] animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/60'
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className='flex flex-col items-center justify-center gap-3 rounded-3xl border border-zinc-800 bg-zinc-900/40 py-20 text-center'>
            <Radio className='size-12 text-zinc-600' />
            <p className='font-medium text-zinc-200'>
              {category === '全部' ? '暂无开播的数字人' : `「${category}」分类暂无开播`}
            </p>
            <p className='text-sm text-zinc-500'>管理员在后台开启直播后，会出现在这里。</p>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
            {filtered.map((session) => (
              <Link
                key={session.avatarId}
                href={`/rooms/${session.avatarId}`}
                className='group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 transition duration-300 hover:-translate-y-1 hover:border-zinc-600 hover:shadow-xl hover:shadow-black/50'
              >
                {session.imageS3Url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote storage origin, plain img is simplest
                  <img
                    src={session.imageS3Url}
                    alt={session.avatarName}
                    className='aspect-[9/16] w-full object-cover transition duration-300 group-hover:scale-[1.05]'
                  />
                ) : (
                  <div className='flex aspect-[9/16] w-full items-center justify-center bg-zinc-900 text-zinc-600'>
                    <Clapperboard className='size-8 text-zinc-600' />
                  </div>
                )}
                <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-3 pb-3 pt-12'>
                  <p className='truncate text-sm font-semibold text-white'>
                    {session.avatarName}
                    {session.age != null && (
                      <span className='ml-1 font-normal text-white/60'>
                        {session.age}岁
                      </span>
                    )}
                  </p>
                  <div className='mt-1.5 flex items-center gap-1.5'>
                    <span className='rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] text-white/80 backdrop-blur'>
                      {session.category || '其他'}
                    </span>
                  </div>
                </div>
                <span className='absolute right-2 top-2 flex items-center gap-1 rounded-full bg-gradient-to-r from-red-600 to-red-500 px-2 py-0.5 text-xs font-medium text-white shadow-lg shadow-red-600/30'>
                  <span className='size-1.5 animate-pulse rounded-full bg-white' />
                  直播中
                </span>
                <span className='absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur'>
                  #{session.avatarId}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className='border-t border-zinc-800/60 py-5 text-center text-xs text-zinc-600'>
        灵播 · AI 数字人直播平台
      </footer>
    </div>
  )
}
