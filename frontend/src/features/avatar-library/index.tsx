import axios from 'axios'
import { ImageIcon, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type Avatar } from '@/lib/api'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function showApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { error?: string } | undefined)?.error ?? '加载失败，请稍后重试'
  }
  return '加载失败，请稍后重试'
}

export function AvatarLibrary() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAvatars = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<{ data: Avatar[] }>('/avatars')
      setAvatars(data.data)
    } catch (error) {
      setError(showApiError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAvatars()
  }, [loadAvatars])

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>数字人列表</h2>
            <p className='text-muted-foreground'>
              管理已创建的数字人形象，选择其一直接开始创作，或上传新形象。
            </p>
          </div>
          <Button asChild>
            <Link to='/avatar-studio'>
              <Plus className='size-4' />
              新建数字人
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {Array.from({ length: 8 }, (_, i) => (
              <Card key={i} className='overflow-hidden'>
                <Skeleton className='aspect-video w-full rounded-none' />
                <CardHeader className='gap-1.5'>
                  <Skeleton className='h-5 w-2/3' />
                  <Skeleton className='h-4 w-1/3' />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card>
            <CardHeader>
              <CardTitle>加载失败</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant='outline' onClick={() => void loadAvatars()}>
                <RefreshCw className='size-4' />
                重试
              </Button>
            </CardContent>
          </Card>
        ) : avatars.length === 0 ? (
          <Card>
            <CardHeader className='items-center text-center'>
              <ImageIcon className='mb-2 size-10 text-muted-foreground' />
              <CardTitle>还没有数字人</CardTitle>
              <CardDescription>
                上传一张形象图片（可附带克隆音色），即可创建第一个数字人。
              </CardDescription>
            </CardHeader>
            <CardContent className='flex justify-center'>
              <Button asChild>
                <Link to='/avatar-studio'>
                  <Plus className='size-4' />
                  创建第一个数字人
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {avatars.map((avatar) => (
              <Card key={avatar.id} className='overflow-hidden'>
                {avatar.imageS3Url ? (
                  <img
                    src={avatar.imageS3Url}
                    alt={avatar.name}
                    className='aspect-video w-full border-b object-cover'
                    loading='lazy'
                  />
                ) : (
                  <div className='flex aspect-video w-full items-center justify-center border-b bg-muted'>
                    <ImageIcon className='size-8 text-muted-foreground' />
                  </div>
                )}
                <CardHeader className='gap-1.5'>
                  <CardTitle className='flex items-center justify-between gap-2 text-base'>
                    <span className='truncate'>{avatar.name}</span>
                    <Badge variant='secondary' className='shrink-0'>
                      #{avatar.id}
                    </Badge>
                  </CardTitle>
                  <CardDescription className='flex flex-wrap items-center gap-2'>
                    <span>{formatDate(avatar.createdAt)}</span>
                    {avatar.voiceAudioS3Url ? (
                      <Badge variant='outline'>含克隆音色</Badge>
                    ) : (
                      <Badge variant='outline'>未上传音色</Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className='flex gap-2'>
                  <Button asChild size='sm' className='flex-1'>
                    <Link to='/avatar-studio' search={{ avatarId: String(avatar.id) }}>
                      <Sparkles className='size-4' />
                      开始创作
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  )
}
