import axios from 'axios'
import { LoaderCircle, Play, Send, Video } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { VideoPlayerDialog } from '@/components/video-player-dialog'
import { XgVideo } from '@/components/xg-video'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { EDGE_TTS_VOICES } from '@/features/avatar-studio/voices'
import { api, type Avatar, type BroadcastTask } from '@/lib/api'

function showApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? '请求失败，请稍后重试')
    return
  }
  toast.error('请求失败，请稍后重试')
}

const TASK_STATUS_META: Record<
  BroadcastTask['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending: { label: '排队中', variant: 'secondary' },
  processing: { label: '合成中', variant: 'default' },
  completed: { label: '已完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

function useTaskPolling(taskId: number | null) {
  const [task, setTask] = useState<BroadcastTask | null>(null)

  useEffect(() => {
    if (!taskId) return
    let stopped = false
    let timer: number | undefined
    let attempts = 0
    const MAX_ATTEMPTS = 300

    const poll = async () => {
      if (stopped || attempts >= MAX_ATTEMPTS) return
      attempts += 1
      try {
        const { data } = await api.get<BroadcastTask>(`/tasks/${taskId}`)
        if (stopped) return
        setTask(data)
        if (data.status === 'completed' || data.status === 'failed') return
        timer = window.setTimeout(poll, 2500)
      } catch {
        if (!stopped) timer = window.setTimeout(poll, 2500)
      }
    }

    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [taskId])

  return task
}

export function Broadcast({
  initialAvatarId,
  initialTaskId,
}: {
  initialAvatarId?: string
  initialTaskId?: string
}) {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [history, setHistory] = useState<BroadcastTask[]>([])
  const [selectedAvatarId, setSelectedAvatarId] = useState('')
  const [script, setScript] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [taskId, setTaskId] = useState<number | null>(null)
  const [playUrl, setPlayUrl] = useState<string | null>(null)

  const task = useTaskPolling(taskId)
  const historyRef = useRef<HTMLDivElement>(null)
  const selectedAvatar = avatars.find((a) => String(a.id) === selectedAvatarId)
  const readyAvatars = avatars.filter((avatar) => avatar.status === 'ready')
  const selectedVoiceLabel =
    EDGE_TTS_VOICES.find((voice) => voice.id === selectedAvatar?.voiceId)?.label ??
    selectedAvatar?.voiceId

  const loadAvatars = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Avatar[] }>('/avatars')
      setAvatars(data.data)
      if (!selectedAvatarId && initialAvatarId) {
        setSelectedAvatarId(initialAvatarId)
      }
    } catch {
      // ignore: page will show empty state
    }
  }, [initialAvatarId, selectedAvatarId])

  useEffect(() => {
    void loadAvatars()
  }, [loadAvatars])

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: BroadcastTask[] }>('/tasks')
      setHistory(data.data)
    } catch {
      // ignore: history is a secondary panel
    }
  }, [])

  useEffect(() => {
    void loadHistory()
    const timer = window.setInterval(() => void loadHistory(), 3000)
    return () => window.clearInterval(timer)
  }, [loadHistory])

  // Scroll the highlighted history row into view when arriving from the task
  // center (?taskId=...).
  useEffect(() => {
    if (!initialTaskId) return
    const row = document.getElementById(`history-row-${initialTaskId}`)
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [history, initialTaskId])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedAvatarId) {
      toast.error('请选择数字人')
      return
    }
    if (!script.trim()) {
      toast.error('请填写播报脚本')
      return
    }
    setSubmitting(true)
    try {
      const { data } = await api.post<BroadcastTask>('/tasks', {
        avatarId: Number(selectedAvatarId),
        scriptText: script.trim(),
      })
      setTaskId(data.id)
      void loadHistory()
    } catch (error) {
      showApiError(error)
    } finally {
      setSubmitting(false)
    }
  }

  const statusVariant =
    task?.status === 'completed'
      ? 'default'
      : task?.status === 'failed'
        ? 'destructive'
        : task
          ? 'secondary'
          : 'outline'

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>播报制作</h2>
          <p className='text-muted-foreground'>
            选择已就绪的数字人并输入脚本，生成离线口播视频（Edge-TTS + Wav2Lip）。
          </p>
        </div>

        <div className='grid gap-4 lg:grid-cols-2'>
          {readyAvatars.length === 0 ? (
            <Card>
              <CardHeader className='items-center text-center'>
                <CardTitle>还没有可用的数字人</CardTitle>
                <CardDescription>
                  播报需要已完成基础视频生成的数字人（状态为「就绪」）。
                  请先到 Avatar Studio 创建。
                </CardDescription>
              </CardHeader>
              <CardContent className='flex justify-center'>
                <Button asChild>
                  <Link to='/avatar-studio'>去创建数字人</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>任务配置</CardTitle>
                <CardDescription>
                  数字人需已完成基础视频生成（状态为「就绪」）。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className='flex flex-col gap-5'>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-select'>选择数字人</Label>
                  <Select value={selectedAvatarId} onValueChange={setSelectedAvatarId}>
                    <SelectTrigger id='avatar-select' className='w-full'>
                      <SelectValue placeholder='选择数字人' />
                    </SelectTrigger>
                    <SelectContent>
                      {avatars.map((avatar) => (
                        <SelectItem
                          key={avatar.id}
                          value={String(avatar.id)}
                          disabled={avatar.status !== 'ready'}
                        >
                          {avatar.name} (#{avatar.id})
                          {avatar.status !== 'ready' ? ' · 生成中' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedAvatar && (
                    <div className='mt-1 flex items-center gap-3 rounded-lg border p-3'>
                      <img
                        src={selectedAvatar.imageS3Url}
                        alt={selectedAvatar.name}
                        className='h-16 w-16 rounded-lg border object-cover'
                      />
                      <div className='min-w-0 text-sm'>
                        <p className='truncate font-medium'>{selectedAvatar.name} (#{selectedAvatar.id})</p>
                        <p className='truncate text-muted-foreground'>音色：{selectedVoiceLabel}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='script'>播报脚本</Label>
                  <Textarea
                    id='script'
                    value={script}
                    onChange={(event) => setScript(event.target.value)}
                    placeholder='输入播报内容，例如：大家好，欢迎收听今天的新闻摘要。'
                    rows={6}
                  />
                </div>

                <Button type='submit' disabled={submitting || !selectedAvatarId || !script.trim()}>
                  {submitting ? <LoaderCircle className='size-4 animate-spin' /> : <Send className='size-4' />}
                  提交任务
                </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className='flex-row items-center justify-between space-y-0'>
              <CardTitle>任务状态</CardTitle>
              {task && (
                <Badge variant={statusVariant}>
                  {task.status === 'completed'
                    ? '已完成'
                    : task.status === 'failed'
                      ? '失败'
                      : task.status === 'processing'
                        ? '合成中'
                        : '排队中'}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {!task ? (
                <div className='flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground'>
                  <Video className='size-8' />
                  <span>提交任务后，这里会显示合成进度与成品视频。</span>
                </div>
              ) : task.status === 'completed' && task.outputVideoS3Url ? (
                <div className='flex justify-center'>
                  <XgVideo
                    url={task.outputVideoS3Url}
                    className='aspect-[2/3] w-full max-w-[720px] rounded-lg border bg-black'
                  />
                </div>
              ) : task.status === 'failed' ? (
                <p className='py-8 text-center text-sm text-destructive'>
                  合成失败：{task.errorMessage ?? '未知错误'}
                </p>
              ) : (
                <div className='flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground'>
                  <LoaderCircle className='size-8 animate-spin' />
                  <span>
                    {task.status === 'processing'
                      ? '正在合成口播视频（Edge-TTS + Wav2Lip）…'
                      : '任务排队中…'}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className='gap-1'>
            <CardTitle>制作历史</CardTitle>
            <CardDescription>
              本数字人（及全部头像）的历史播报任务，3 秒自动刷新。
            </CardDescription>
          </CardHeader>
          <CardContent ref={historyRef}>
            {history.length === 0 ? (
              <p className='py-6 text-center text-sm text-muted-foreground'>
                暂无制作历史
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>头像</TableHead>
                    <TableHead>脚本</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className='text-right'>成品</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((item) => {
                    const meta = TASK_STATUS_META[item.status]
                    const highlighted = initialTaskId === String(item.id)
                    return (
                      <TableRow
                        key={item.id}
                        id={`history-row-${item.id}`}
                        className={
                          highlighted
                            ? 'bg-primary/10 ring-2 ring-primary/50'
                            : undefined
                        }
                      >
                        <TableCell>#{item.id}</TableCell>
                        <TableCell>{item.avatarName ?? `#${item.avatarId}`}</TableCell>
                        <TableCell className='max-w-[280px] truncate' title={item.scriptText}>
                          {item.scriptText}
                        </TableCell>
                        <TableCell>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-sm text-muted-foreground'>
                          {formatTime(item.createdAt)}
                        </TableCell>
                        <TableCell className='text-right'>
                          {item.status === 'completed' && item.outputVideoS3Url ? (
                            <Button
                              variant='outline'
                              size='sm'
                              onClick={() => setPlayUrl(item.outputVideoS3Url!)}
                            >
                              <Play className='size-3.5' />
                              播放
                            </Button>
                          ) : (
                            <span className='text-xs text-muted-foreground'>-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <VideoPlayerDialog
          open={playUrl !== null}
          url={playUrl ?? undefined}
          title='播报成品'
          onClose={() => setPlayUrl(null)}
        />
      </Main>
    </>
  )
}
