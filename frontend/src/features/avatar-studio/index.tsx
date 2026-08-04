import axios from 'axios'
import { LoaderCircle, Upload, Video } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, type Avatar, type BroadcastTask, type TaskStatus } from '@/lib/api'

const STATUS_META: Record<
  TaskStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending: { label: '排队中', variant: 'secondary' },
  processing: { label: '合成中', variant: 'default' },
  completed: { label: '已完成', variant: 'default' },
  failed: { label: '失败', variant: 'destructive' },
}

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
    const MAX_ATTEMPTS = 300 // ~12 minutes

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

export function AvatarStudio() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [selectedAvatarId, setSelectedAvatarId] = useState('')
  const [name, setName] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [script, setScript] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [taskId, setTaskId] = useState<number | null>(null)

  const task = useTaskPolling(taskId)
  const usingNewAvatar = selectedAvatarId === ''
  const selectedAvatar = avatars.find((a) => String(a.id) === selectedAvatarId)

  const loadAvatars = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Avatar[] }>('/avatars')
      setAvatars(data.data)
    } catch {
      // Background refresh: do not disturb the user when the API is unreachable.
    }
  }, [])

  useEffect(() => {
    void loadAvatars()
  }, [loadAvatars])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!script.trim()) {
      toast.error('请填写播报脚本')
      return
    }
    if (usingNewAvatar) {
      if (!name.trim()) {
        toast.error('请填写形象名称')
        return
      }
      if (!imageFile) {
        toast.error('请上传形象图片')
        return
      }
    }

    setSubmitting(true)
    try {
      let avatarId = Number(selectedAvatarId)
      if (!avatarId) {
        const form = new FormData()
        form.append('name', name.trim())
        form.append('image', imageFile as File)
        if (audioFile) form.append('voice_audio', audioFile)

        const { data: avatar } = await api.post<Avatar>('/avatars', form)
        avatarId = avatar.id
        void loadAvatars()
      }

      const { data: created } = await api.post<BroadcastTask>('/tasks', {
        avatarId,
        scriptText: script.trim(),
      })
      setTaskId(created.id)
    } catch (error) {
      showApiError(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Avatar Studio</h2>
          <p className='text-muted-foreground'>
            上传素材并输入播报脚本，合成嘴型同步的数字人视频。
          </p>
        </div>

        <div className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>素材与任务配置</CardTitle>
              <CardDescription>
                可复用已有形象，或上传新形象图片（必填）与克隆音频（可选）。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className='flex flex-col gap-5'>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-select'>选择已有形象（可选）</Label>
                  <Select value={selectedAvatarId} onValueChange={setSelectedAvatarId}>
                    <SelectTrigger id='avatar-select' className='w-full'>
                      <SelectValue placeholder='新建形象' />
                    </SelectTrigger>
                    <SelectContent>
                      {avatars.map((avatar) => (
                        <SelectItem key={avatar.id} value={String(avatar.id)}>
                          {avatar.name} (#{avatar.id})
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

                {usingNewAvatar && (
                  <>
                    <div className='flex flex-col gap-2'>
                      <Label htmlFor='avatar-name'>形象名称 *</Label>
                      <Input
                        id='avatar-name'
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder='例如：小林'
                      />
                    </div>

                    <div className='flex flex-col gap-2'>
                      <Label htmlFor='avatar-image'>
                        <span className='inline-flex items-center gap-1'>
                          <Upload className='size-3.5' /> 形象图片 *
                        </span>
                      </Label>
                      <Input
                        id='avatar-image'
                        type='file'
                        accept='image/*'
                        onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                      />
                      <p className='text-xs text-muted-foreground'>
                        {imageFile ? imageFile.name : '支持 JPG / PNG，建议正方形图片'}
                      </p>
                    </div>

                    <div className='flex flex-col gap-2'>
                      <Label htmlFor='voice-audio'>语音克隆音频（可选）</Label>
                      <Input
                        id='voice-audio'
                        type='file'
                        accept='audio/*'
                        onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                      />
                      <p className='text-xs text-muted-foreground'>
                        {audioFile ? audioFile.name : '支持 WAV / MP3，用于声音克隆'}
                      </p>
                    </div>
                  </>
                )}

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='script'>播报脚本 *</Label>
                  <Textarea
                    id='script'
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder='请输入需要数字人口播的文本内容…'
                    rows={6}
                  />
                </div>

                <Button type='submit' disabled={submitting}>
                  {submitting && <LoaderCircle className='size-4 animate-spin' />}
                  开始合成
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>合成结果</CardTitle>
              <CardDescription>
                提交任务后自动轮询进度，完成后在此处播放生成的视频。
              </CardDescription>
            </CardHeader>
            <CardContent className='flex min-h-72 flex-col gap-4'>
              {!task && (
                <div className='flex h-full flex-1 items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground'>
                  尚未提交任务
                </div>
              )}

              {task && (
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                    <Video className='size-4' />
                    任务 #{task.id}
                  </div>
                  <Badge variant={STATUS_META[task.status].variant}>
                    {STATUS_META[task.status].label}
                  </Badge>
                </div>
              )}

              {(task?.status === 'pending' || task?.status === 'processing') && (
                <div className='flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border p-8'>
                  <LoaderCircle className='size-8 animate-spin text-muted-foreground' />
                  <p className='text-sm text-muted-foreground'>
                    数字人合成中，请稍候…
                  </p>
                </div>
              )}

              {task?.status === 'failed' && (
                <div className='flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 p-8 text-sm text-destructive'>
                  <p>任务执行失败</p>
                  {task.errorMessage && (
                    <p className='max-w-full break-all text-xs text-muted-foreground'>
                      {task.errorMessage}
                    </p>
                  )}
                </div>
              )}

              {task?.status === 'completed' && task.outputVideoS3Url && (
                <video
                  src={task.outputVideoS3Url}
                  controls
                  className='aspect-video w-full rounded-lg border bg-black'
                />
              )}
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}
