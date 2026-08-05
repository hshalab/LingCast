'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import NavHeader from '@/components/nav-header'
import { listLiveSessions, type LiveSessionItem } from '@/lib/api'

const CATEGORIES = ['闲聊', '知识', '娱乐', '游戏', '带货', '其他']

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
    return CATEGORIES.filter((c) => present.has(c))
  }, [sessions])

  const filtered =
    category === '全部'
      ? sessions
      : sessions.filter((s) => (s.category || '其他') === category)

  return (
    <div className='flex min-h-screen flex-col'>
      <NavHeader />

      <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6'>
        <section className='mb-6'>
          <h1 className='text-2xl font-bold tracking-tight'>正在开播</h1>
          <p className='mt-1 text-sm text-zinc-500'>
            点击进入房间观看直播、发消息互动，数字人会通过 AI 实时回复你。
          </p>
        </section>

        {/* Category filter */}
        <div className='mb-5 flex flex-wrap items-center gap-2'>
          <button
            onClick={() => setCategory('全部')}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              category === '全部'
                ? 'bg-blue-600 font-medium text-white'
                : 'border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            全部
          </button>
          {availableCategories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                category === c
                  ? 'bg-blue-600 font-medium text-white'
                  : 'border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <p className='py-16 text-center text-sm text-zinc-500'>加载中…</p>
        ) : filtered.length === 0 ? (
          <div className='flex flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-800 py-20 text-center'>
            <span className='text-4xl'>📡</span>
            <p className='font-medium'>
              {category === '全部' ? '暂无开播的数字人' : `「${category}」分类暂无开播`}
            </p>
            <p className='text-sm text-zinc-500'>
              管理员在后台开启直播后，会出现在这里。
            </p>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
            {filtered.map((session) => (
              <Link
                key={session.avatarId}
                href={`/rooms/${session.avatarId}`}
                className='group relative overflow-hidden rounded-2xl border border-zinc-800 transition hover:-translate-y-0.5 hover:border-zinc-600 hover:shadow-lg hover:shadow-black/40'
              >
                {session.imageS3Url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote storage origin, plain img is simplest
                  <img
                    src={session.imageS3Url}
                    alt={session.avatarName}
                    className='aspect-[9/16] w-full object-cover transition duration-300 group-hover:scale-[1.03]'
                  />
                ) : (
                  <div className='flex aspect-[9/16] w-full items-center justify-center bg-zinc-900 text-zinc-600'>
                    <span className='text-3xl'>🎭</span>
                  </div>
                )}
                <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2.5 pt-10'>
                  <p className='truncate text-sm font-semibold text-white'>
                    {session.avatarName}
                    {session.age != null && (
                      <span className='ml-1 font-normal text-white/70'>
                        {session.age}岁
                      </span>
                    )}
                  </p>
                  <p className='mt-0.5 text-xs text-white/60'>{session.category || '其他'}</p>
                </div>
                <span className='absolute right-2 top-2 flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white'>
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
        数字人直播间 · 登录后聊天记录不丢失
      </footer>

    </div>
  )
}
