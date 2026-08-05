import { Radio, RefreshCw, Tv } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api, type LiveSessionItem } from '@/lib/api'

export function RoomsList() {
  const [sessions, setSessions] = useState<LiveSessionItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const { data } = await api.get<{ data: LiveSessionItem[] }>('/live')
        if (!stopped) setSessions(data.data)
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
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <Tv className='size-6' />
              直播间
            </h2>
            <p className='text-muted-foreground'>
              查看正在开播的数字人，进入房间即可观看并与它互动。
            </p>
          </div>
          <Button variant='outline' size='sm' onClick={() => setLoading(true)}>
            <RefreshCw className='size-4' />
            刷新
          </Button>
        </div>

        {loading ? (
          <p className='py-10 text-center text-sm text-muted-foreground'>加载中…</p>
        ) : sessions.length === 0 ? (
          <Card>
            <CardHeader className='items-center text-center'>
              <Radio className='mb-2 size-10 text-muted-foreground' />
              <CardTitle>暂无开播的数字人</CardTitle>
              <CardDescription>管理员在 Live Studio 开启直播后，会出现在这里。</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
            {sessions.map((session) => (
              <Link
                key={session.avatarId}
                to='/rooms/$avatarId'
                params={{ avatarId: String(session.avatarId) }}
                className='group relative overflow-hidden rounded-xl border'
              >
                {session.imageS3Url ? (
                  <img
                    src={session.imageS3Url}
                    alt={session.avatarName}
                    className='aspect-[9/16] w-full object-cover'
                  />
                ) : (
                  <div className='flex aspect-[9/16] w-full items-center justify-center bg-muted'>
                    <Tv className='size-8 text-muted-foreground' />
                  </div>
                )}
                <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-white'>
                  <p className='truncate text-sm font-medium'>{session.avatarName}</p>
                </div>
                <Badge className='absolute start-2 top-2 border-0 bg-red-600 text-white'>
                  <Radio className='me-1 size-3' />
                  直播中
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Main>
    </>
  )
}
