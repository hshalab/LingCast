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
  Play,
  Radio,
  ShoppingCart,
  Sparkles,
  Tv,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import NavHeader from '@/components/nav-header'
import { listLiveSessions, type LiveSessionItem } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

const CATEGORIES: { key: string; i18nKey: string; icon: typeof Compass }[] = [
  { key: '全部', i18nKey: 'category.all', icon: Compass },
  { key: '闲聊', i18nKey: 'category.chat', icon: MessageCircle },
  { key: '知识', i18nKey: 'category.knowledge', icon: BookOpen },
  { key: '娱乐', i18nKey: 'category.entertainment', icon: Mic },
  { key: '游戏', i18nKey: 'category.game', icon: Gamepad2 },
  { key: '带货', i18nKey: 'category.sales', icon: ShoppingCart },
  { key: '其他', i18nKey: 'category.other', icon: Sparkles },
]

export default function Home() {
  const { t } = useI18n()
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
    <div className='flex min-h-screen flex-col bg-background'>
      <NavHeader />

      <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6'>
        {/* Hero 横幅 */}
        <section className='relative mb-6 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-blue-600/25 via-surface to-violet-600/20 p-6 sm:p-8'>
          <div className='pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-blue-500/20 blur-3xl' />
          <div className='pointer-events-none absolute -bottom-20 -left-10 size-64 rounded-full bg-violet-500/20 blur-3xl' />
          <div className='relative z-10'>
            <h1 className='text-2xl font-bold tracking-tight sm:text-3xl'>
              {t('home.liveNow')}
              <Flame className='ml-2 inline size-6 text-orange-400' />
            </h1>
            <p className='mt-2 max-w-md text-sm text-muted'>
              {t('home.heroDesc')}
            </p>
            <div className='mt-4 flex flex-wrap gap-2 text-xs'>
              <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-subtle backdrop-blur'>
                <Tv className='mr-1 inline size-3.5' />
                {t('home.liveCount', { count: sessions.length })}
              </span>
              <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-subtle backdrop-blur'>
                <Palette className='mr-1 inline size-3.5' />
                {t('home.categoryCount', {
                  count: Math.max(availableCategories.length - 1, 0),
                })}
              </span>
            </div>
            {filtered.length > 0 && (
              <Link
                href={`/rooms/${filtered[0].avatarId}`}
                className='mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-600/30 transition hover:brightness-110'
              >
                <Play className='size-4' />
                {t('home.enterRoom')}
              </Link>
            )}
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
                  : 'border border-border bg-surface/60 text-muted hover:border-foreground/40 hover:text-foreground'
              }`}
            >
              <c.icon className='mr-1.5 inline size-4' />
              {t(c.i18nKey)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className='aspect-[9/16] animate-pulse rounded-2xl border border-border bg-surface/60'
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className='flex flex-col items-center justify-center gap-3 rounded-3xl border border-border bg-surface/40 py-20 text-center'>
            <Radio className='size-12 text-faint' />
            <p className='font-medium text-foreground'>
              {category === '全部'
                ? t('home.emptyAll')
                : t('home.emptyCategory', {
                    category: t(
                      CATEGORIES.find((c) => c.key === category)?.i18nKey ??
                        'category.other',
                    ),
                  })}
            </p>
            <p className='text-sm text-muted'>{t('home.emptyHint')}</p>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
            {filtered.map((session) => (
              <Link
                key={session.avatarId}
                href={`/rooms/${session.avatarId}`}
                className='group relative overflow-hidden rounded-2xl border border-border bg-surface/40 transition duration-300 hover:-translate-y-1 hover:border-foreground/40 hover:shadow-xl hover:shadow-black/50'
              >
                {session.imageS3Url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote storage origin, plain img is simplest
                  <img
                    src={session.imageS3Url}
                    alt={session.avatarName}
                    className='aspect-[9/16] w-full object-cover transition duration-300 group-hover:scale-[1.05]'
                  />
                ) : (
                  <div className='flex aspect-[9/16] w-full items-center justify-center bg-surface text-faint'>
                    <Clapperboard className='size-8 text-faint' />
                  </div>
                )}
                <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-3 pb-3 pt-12'>
                  <p className='truncate text-sm font-semibold text-white'>
                    {session.avatarName}
                        {session.age != null && (
                      <span className='ml-1 font-normal text-white/60'>
                        {t('home.age', { age: session.age })}
                      </span>
                    )}
                  </p>
                  <div className='mt-1.5 flex items-center gap-1.5'>
                    <span className='rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] text-white/80 backdrop-blur'>
                      {session.category || '其他'}
                    </span>
                  </div>
                </div>
                {/* 悬停：进入直播间 */}
                <div className='absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[2px] transition duration-300 group-hover:opacity-100'>
                  <span className='flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur'>
                    <Play className='size-4' />
                    {t('home.enterRoom')}
                  </span>
                </div>
                <span className='absolute right-2 top-2 flex items-center gap-1 rounded-full bg-gradient-to-r from-red-600 to-red-500 px-2 py-0.5 text-xs font-medium text-white shadow-lg shadow-red-600/30'>
                  <span className='size-1.5 animate-pulse rounded-full bg-white' />
                      {t('home.live')}
                </span>
                <span className='absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur'>
                  #{session.avatarId}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className='border-t border-border/60 py-5 text-center text-xs text-faint'>
        <div className='mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 sm:flex-row sm:px-6'>
          <span>{t('home.footer')}</span>
          <Link
            href='/account'
            className='text-subtle transition hover:text-foreground'
          >
            {t('nav.accountCenter')}
          </Link>
        </div>
      </footer>
    </div>
  )
}
