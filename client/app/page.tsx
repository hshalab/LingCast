'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { listLiveSessions, type LiveSessionItem } from '@/lib/api'

export default function Home() {
  const [sessions, setSessions] = useState<LiveSessionItem[]>([])
  const [loading, setLoading] = useState(true)

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

  return (
    <main className='mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6'>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold tracking-tight'>数字人直播间</h1>
        <p className='mt-1 text-sm text-zinc-400'>
          正在开播的数字人，点击进入房间观看并与 TA 互动。
        </p>
      </header>

      {loading ? (
        <p className='py-16 text-center text-sm text-zinc-500'>加载中…</p>
      ) : sessions.length === 0 ? (
        <div className='flex flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-800 py-20 text-center'>
          <span className='text-4xl'>📡</span>
          <p className='font-medium'>暂无开播的数字人</p>
          <p className='text-sm text-zinc-500'>管理员在后台开启直播后，会出现在这里。</p>
        </div>
      ) : (
        <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
          {sessions.map((session) => (
            <Link
              key={session.avatarId}
              href={`/rooms/${session.avatarId}`}
              className='group relative overflow-hidden rounded-2xl border border-zinc-800 transition hover:border-zinc-600'
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
              <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8'>
                <p className='truncate text-sm font-medium text-white'>
                  {session.avatarName}
                </p>
              </div>
              <span className='absolute right-2 top-2 flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white'>
                <span className='size-1.5 animate-pulse rounded-full bg-white' />
                直播中
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
