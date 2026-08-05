import axios from 'axios'
import { LoaderCircle, Send, Video } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, type Avatar, type BroadcastTask } from '@/lib/api'

function showApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? '请求失败，请稍后重试')
    return
  }
  toast.error('请求失败，请稍后重试')
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

export function Broadcast({ initialAvatarId }: { initialAvatarId?: string }) {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [selectedAvatarId, setSelectedAvatarId] = useState('')
  const [script, setScript] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [taskId, setTaskId] = useState<number | null>(null)

  const task = useTaskPolling(taskId)
  const selectedAvatar = avatars.find((a) => String(a.id) === selectedAvatarId)

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
                  {selectedAvatar?.imageS3Url && (
                    <img
                      src={selectedAvatar.imageS3Url}
                      alt={selectedAvatar.name}
                      className='mt-1 h-24 w-24 rounded-lg border object-cover'
                    />
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
                <video src={task.outputVideoS3Url} controls className='aspect-video w-full rounded-lg border bg-black' />
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
      </Main>
    </>
  )
}
