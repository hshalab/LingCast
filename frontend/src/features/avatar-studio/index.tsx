import axios from 'axios'
import { CheckCircle2, LoaderCircle, Play, Upload, Volume2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
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
import { api, type Avatar } from '@/lib/api'
import { VideoPlayerDialog } from '@/components/video-player-dialog'
import {
  cacheVoices,
  DEFAULT_VOICE_ID,
  getCachedVoices,
  type EdgeVoice,
} from './voices'

function showApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? '请求失败，请稍后重试')
    return
  }
  toast.error('请求失败，请稍后重试')
}

const PREVIEW_TEXT = '你好，我是你的数字人助理，很高兴认识你。'

export function AvatarStudio() {
  const [name, setName] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [voices] = useState<EdgeVoice[]>(() => {
    const cached = getCachedVoices()
    cacheVoices(cached) // refresh cache so it is always available offline
    return cached
  })
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [submitting, setSubmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [created, setCreated] = useState<Avatar | null>(null)
  const [initFailed, setInitFailed] = useState(false)

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.id === voiceId) ?? voices[0],
    [voices, voiceId],
  )

  // Poll the avatar's initialization status after creation.
  useEffect(() => {
    if (!created || created.status === 'ready' || created.status === 'failed') return
    let stopped = false
    let timer: number | undefined
    let attempts = 0

    const poll = async () => {
      if (stopped || attempts >= 60) return
      attempts += 1
      try {
        const { data } = await api.get<Avatar>(`/avatars/${created.id}`)
        if (stopped) return
        setCreated(data)
        if (data.status === 'ready' || data.status === 'failed') return
        timer = window.setTimeout(poll, 3000)
      } catch {
        if (!stopped) timer = window.setTimeout(poll, 3000)
      }
    }

    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [created])

  useEffect(() => {
    if (created?.status === 'ready') {
      toast.success('基础视频已生成，数字人创建完成')
    }
    if (created?.status === 'failed') {
      setInitFailed(true)
      toast.error('基础视频生成失败，请检查 worker 日志后重试')
    }
  }, [created?.status])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      toast.error('请填写形象名称')
      return
    }
    if (!imageFile) {
      toast.error('请上传形象图片')
      return
    }

    setSubmitting(true)
    setInitFailed(false)
    try {
      const form = new FormData()
      form.append('name', name.trim())
      form.append('image', imageFile)
      form.append('voice_id', voiceId)
      const { data } = await api.post<Avatar>('/avatars', form)
      setCreated(data)
      setSubmitting(false)
      toast.info('已提交，正在生成基础视频…')
    } catch (error) {
      setSubmitting(false)
      showApiError(error)
    }
  }

  const isInitializing = created != null && created.status === 'initializing'

  const handlePreview = async () => {
    if (previewing) return
    setPreviewing(true)
    try {
      const { data } = await api.post<Blob>(
        '/tts/preview',
        { voiceId, text: PREVIEW_TEXT },
        { responseType: 'blob' },
      )
      const url = URL.createObjectURL(data)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
      toast.info('正在播放试听…')
    } catch (error) {
      showApiError(error)
    } finally {
      setPreviewing(false)
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
            创建数字人身份：上传形象图片并选择播报音色，系统会自动生成基础驱动视频。
          </p>
        </div>

        <div className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>创建数字人</CardTitle>
              <CardDescription>
                提交后进入基础视频生成阶段（LivePortrait 预处理），完成后即可用于播报与直播。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className='flex flex-col gap-5'>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-name'>形象名称</Label>
                  <Input
                    id='avatar-name'
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder='例如：小美'
                    disabled={isInitializing}
                  />
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-image'>形象图片</Label>
                  <Input
                    id='avatar-image'
                    type='file'
                    accept='image/*'
                    disabled={isInitializing}
                    onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                  />
                  {imageFile && (
                    <img
                      src={URL.createObjectURL(imageFile)}
                      alt='preview'
                      className='mt-1 aspect-[9/16] w-24 rounded-lg border object-cover'
                    />
                  )}
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-voice'>播报音色</Label>
                  <div className='flex items-center gap-2'>
                    <Select value={voiceId} onValueChange={setVoiceId} disabled={isInitializing}>
                      <SelectTrigger id='avatar-voice' className='w-full'>
                        <SelectValue placeholder='选择音色' />
                      </SelectTrigger>
                      <SelectContent>
                        {voices.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type='button'
                      variant='outline'
                      size='icon'
                      onClick={() => void handlePreview()}
                      disabled={previewing || isInitializing}
                      title={`试听：${selectedVoice?.label ?? voiceId}`}
                    >
                      {previewing ? (
                        <LoaderCircle className='size-4 animate-spin' />
                      ) : (
                        <Volume2 className='size-4' />
                      )}
                    </Button>
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    当前：{selectedVoice?.label ?? voiceId}（Edge-TTS，云端合成，无需 GPU）
                  </p>
                </div>

                <Button type='submit' disabled={submitting || isInitializing}>
                  {submitting || isInitializing ? (
                    <LoaderCircle className='size-4 animate-spin' />
                  ) : (
                    <Upload className='size-4' />
                  )}
                  {isInitializing ? '基础视频生成中…' : '创建数字人'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {isInitializing && (
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <LoaderCircle className='size-5 animate-spin' />
                  正在生成基础视频
                </CardTitle>
                <CardDescription>
                  LivePortrait 正在把形象图片合成为动态驱动视频（约 1-2 分钟），
                  完成后本页会自动更新。
                </CardDescription>
              </CardHeader>
              <CardContent className='flex items-center gap-2'>
                <Badge variant='secondary'>初始化中</Badge>
                <span className='text-sm text-muted-foreground'>
                  可离开本页，稍后到数字人列表查看状态
                </span>
              </CardContent>
            </Card>
          )}

          {created?.status === 'ready' && (
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-green-600'>
                  <CheckCircle2 className='size-5' />
                  创建完成
                </CardTitle>
                <CardDescription>
                  「{created.name}」的基础视频已就绪，可以开始播报或直播了。
                </CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                {created.baseVideoS3Url && (
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => setPreviewOpen(true)}
                  >
                    <Play className='size-4' />
                    播放默认视频
                  </Button>
                )}
                <div className='flex gap-2'>
                  <Button asChild>
                    <Link to='/broadcast' search={{ avatarId: String(created.id) }}>
                      去播报
                    </Link>
                  </Button>
                  <Button asChild variant='outline'>
                    <Link to='/avatar-library'>数字人列表</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {initFailed && (
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-destructive'>
                  <XCircle className='size-5' />
                  生成失败
                </CardTitle>
                <CardDescription>
                  基础视频生成失败。请检查宿主机 worker 日志（avatar init 任务）后重试。
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>

        <VideoPlayerDialog
          open={previewOpen}
          url={created?.baseVideoS3Url}
          title={`${created?.name ?? ''} · 默认驱动视频`}
          onClose={() => setPreviewOpen(false)}
        />
      </Main>
    </>
  )
}
