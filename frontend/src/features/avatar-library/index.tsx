import axios from 'axios'
import {
  ImageIcon,
  Pencil,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
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
import { ConfirmDialog } from '@/components/confirm-dialog'
import { api, type Avatar } from '@/lib/api'
import { VideoPlayerDialog } from '@/components/video-player-dialog'

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

export function AvatarLibrary({ initialAvatarId }: { initialAvatarId?: string }) {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Avatar | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Avatar | null>(null)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()

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

  const regenerate = async (avatar: Avatar) => {
    try {
      await api.post(`/avatars/${avatar.id}/retry`)
      toast.success(`「${avatar.name}」开始重新生成基础视频`)
      setPreview(null)
      void loadAvatars()
    } catch (error) {
      toast.error(showApiError(error))
    }
  }

  const removeAvatar = async (avatar: Avatar) => {
    if (!avatar) return
    setDeleting(true)
    try {
      await api.delete(`/avatars/${avatar.id}`)
      toast.success(`已删除「${avatar.name}」`)
      setDeleteTarget(null)
      void loadAvatars()
    } catch (error) {
      toast.error(showApiError(error))
    } finally {
      setDeleting(false)
    }
  }

  // Editing reuses the create page: /avatar-studio?edit=<id>
  const openEdit = (avatar: Avatar) => {
    void navigate({ to: '/avatar-studio', search: { edit: String(avatar.id) } })
  }

  // When arriving from the task center (?avatarId=...), highlight and scroll
  // the matching avatar card into view.
  useEffect(() => {
    if (!initialAvatarId) return
    const row = document.getElementById(`avatar-card-${initialAvatarId}`)
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [avatars, initialAvatarId])

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
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
            <Link to='/avatar-studio' search={{ edit: undefined }}>
              <Plus className='size-4' />
              新建数字人
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {Array.from({ length: 8 }, (_, i) => (
              <Card key={i} className='overflow-hidden py-0'>
                <Skeleton className='aspect-[9/16] w-full rounded-none' />
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
                <Link to='/avatar-studio' search={{ edit: undefined }}>
                  <Plus className='size-4' />
                  创建第一个数字人
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {avatars.map((avatar) => (
              <Card
                key={avatar.id}
                id={`avatar-card-${avatar.id}`}
                className={`group relative overflow-hidden py-0 ${
                  initialAvatarId === String(avatar.id)
                    ? 'ring-2 ring-primary/60'
                    : ''
                }`}
              >
                {avatar.imageS3Url ? (
                  <img
                    src={avatar.imageS3Url}
                    alt={avatar.name}
                    className='aspect-[9/16] w-full object-cover'
                    loading='lazy'
                  />
                ) : (
                  <div className='flex aspect-[9/16] w-full items-center justify-center border-b bg-muted'>
                    <ImageIcon className='size-8 text-muted-foreground' />
                  </div>
                )}

                <div className='absolute start-2 top-2'>
                  {avatar.status === 'ready' ? (
                    <Badge className='border-0 bg-black/60 text-white'>就绪</Badge>
                  ) : avatar.status === 'failed' ? (
                    <Badge variant='destructive'>失败</Badge>
                  ) : (
                    <Badge className='border-0 bg-black/60 text-white'>生成中</Badge>
                  )}
                </div>

                <div className='absolute end-2 top-2 flex gap-1'>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8 bg-black/40 text-white hover:bg-white/20 hover:text-white'
                    title='编辑数字人'
                    onClick={() => openEdit(avatar)}
                  >
                    <Pencil className='size-3.5' />
                  </Button>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8 bg-black/40 text-white hover:bg-red-600/80 hover:text-white'
                    title='删除数字人'
                    onClick={() => setDeleteTarget(avatar)}
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                </div>

                <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3 text-white'>
                  <div className='flex items-center justify-between gap-2'>
                    <p className='truncate font-semibold'>{avatar.name}</p>
                    <Badge variant='secondary' className='shrink-0'>
                      #{avatar.id}
                    </Badge>
                  </div>
                  <p className='mt-0.5 text-xs text-white/70'>{formatDate(avatar.createdAt)}</p>
                  <div className='mt-2 flex items-center gap-1.5'>
                    {avatar.status === 'ready' ? (
                      <>
                        <Button
                          asChild
                          size='sm'
                          className='h-8 flex-1 border-0 bg-white/20 text-white backdrop-blur hover:bg-white/30 hover:text-white'
                        >
                          <Link to='/broadcast' search={{ avatarId: String(avatar.id) }}>
                            <Sparkles className='size-3.5' />
                            播报制作
                          </Link>
                        </Button>
                        <Button
                          asChild
                          size='sm'
                          variant='outline'
                          className='h-8 flex-1 border-white/30 bg-white/20 text-white backdrop-blur hover:bg-white/30 hover:text-white'
                        >
                          <Link to='/live-studio' search={{ avatarId: String(avatar.id) }}>
                            <RadioTower className='size-3.5' />
                            直播
                          </Link>
                        </Button>
                        <Button
                          size='icon'
                          variant='outline'
                          className='h-8 w-8 shrink-0 border-white/30 bg-white/20 text-white backdrop-blur hover:bg-white/30 hover:text-white'
                          onClick={() => setPreview(avatar)}
                          title='预览默认视频'
                        >
                          <Play className='size-3.5' />
                        </Button>
                      </>
                    ) : (
                      <p className='flex h-8 items-center text-xs text-white/80'>
                        基础视频生成中，请稍候
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <VideoPlayerDialog
          open={preview !== null}
          url={preview?.baseVideoS3Url}
          title={`${preview?.name ?? ''} · 默认驱动视频`}
          onClose={() => setPreview(null)}
          actions={
            preview ? (
              <Button size='sm' variant='outline' onClick={() => void regenerate(preview)}>
                <RefreshCw className='size-3.5' />
                重新生成
              </Button>
            ) : undefined
          }
        />

        {/* 删除确认（系统 AlertDialog 封装，非原生 confirm） */}
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title='删除数字人'
          desc={
            deleteTarget
              ? `确定删除数字人「${deleteTarget.name}」？将同时删除其任务、直播会话与视频文件，此操作不可恢复。`
              : ''
          }
          destructive
          isLoading={deleting}
          confirmText={deleting ? '删除中…' : '删除'}
          cancelBtnText='取消'
          handleConfirm={() => void removeAvatar(deleteTarget!)}
        />

      </Main>
    </>
  )
}
