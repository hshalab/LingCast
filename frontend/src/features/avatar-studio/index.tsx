import axios from 'axios'
import { CheckCircle2, LoaderCircle, Play, Upload, UserRound, Volume2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { getRouteApi, Link } from '@tanstack/react-router'
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

const routeApi = getRouteApi('/_authenticated/avatar-studio')

export function AvatarStudio() {
  const { edit: editId } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  const editing = Boolean(editId)
  const [editingAvatar, setEditingAvatar] = useState<Avatar | null>(null)
  const [name, setName] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [voices] = useState<EdgeVoice[]>(() => {
    const cached = getCachedVoices()
    cacheVoices(cached) // refresh cache so it is always available offline
    return cached
  })
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [category, setCategory] = useState('闲聊')
  const [age, setAge] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [ethnicity, setEthnicity] = useState('')
  const [relationshipStatus, setRelationshipStatus] = useState('单身')
  const [personality, setPersonality] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [created, setCreated] = useState<Avatar | null>(null)
  const [initFailed, setInitFailed] = useState(false)

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.id === voiceId) ?? voices[0],
    [voices, voiceId],
  )

  // Edit mode: pre-fill the form from the existing avatar.
  useEffect(() => {
    if (!editId) {
      setEditingAvatar(null)
      return
    }
    api
      .get<Avatar>(`/avatars/${editId}`)
      .then(({ data }) => {
        setEditingAvatar(data)
        setName(data.name ?? '')
        setCategory(data.category ?? '其他')
        setVoiceId(data.voiceId ?? DEFAULT_VOICE_ID)
        setAge(data.age != null ? String(data.age) : '')
        setHeightCm(data.heightCm != null ? String(data.heightCm) : '')
        setWeightKg(data.weightKg != null ? String(data.weightKg) : '')
        setEthnicity(data.ethnicity ?? '')
        setRelationshipStatus(data.relationshipStatus ?? '单身')
        setPersonality(data.personality ?? '')
      })
      .catch(() => toast.error('加载数字人信息失败'))
  }, [editId])

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
    if (!editing && !imageFile) {
      toast.error('请上传形象图片')
      return
    }

    setSubmitting(true)
    setInitFailed(false)
    try {
      const profile = {
        name: name.trim(),
        category,
        voiceId,
        age: age ? Number(age) : null,
        heightCm: heightCm ? Number(heightCm) : null,
        weightKg: weightKg ? Number(weightKg) : null,
        ethnicity: ethnicity.trim(),
        relationshipStatus,
        personality: personality.trim(),
      }
      if (editing && editId) {
        await api.put<Avatar>(`/avatars/${editId}`, profile)
        toast.success('数字人信息已更新')
        void navigate({ to: '/avatar-library' })
        return
      }

      const form = new FormData()
      form.append('name', name.trim())
      form.append('image', imageFile!)
      form.append('voice_id', voiceId)
      form.append('category', category)
      form.append('age', age.trim())
      form.append('height_cm', heightCm.trim())
      form.append('weight_kg', weightKg.trim())
      form.append('ethnicity', ethnicity.trim())
      form.append('relationship_status', relationshipStatus)
      form.append('personality', personality.trim())
      const { data } = await api.post<Avatar>('/avatars', form)
      setCreated(data)
      toast.info('已提交，正在生成基础视频…')
    } catch (error) {
      showApiError(error)
    } finally {
      setSubmitting(false)
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
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Avatar Studio</h2>
          <p className='text-muted-foreground'>
            创建数字人身份：上传形象图片并选择播报音色，系统会自动生成基础驱动视频。
          </p>
        </div>

        <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
        <div className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>{editing ? '编辑数字人' : '创建数字人'}</CardTitle>
              <CardDescription>
                {editing
                  ? '修改数字人的基本信息与人物设定；形象图片与基础视频不受影响。'
                  : '提交后进入基础视频生成阶段（LivePortrait 预处理），完成后即可用于播报与直播。'}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-5'>
                {/* 头像（头部展示）：上传形象图片后显示为圆形头像 */}
                <div className='flex items-center gap-4'>
                  <div className='grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-primary/30 bg-muted'>
                    {editing && editingAvatar ? (
                      <img
                        src={editingAvatar.imageS3Url}
                        alt='avatar'
                        className='size-full object-cover'
                      />
                    ) : imageFile ? (
                      <img
                        src={URL.createObjectURL(imageFile)}
                        alt='avatar'
                        className='size-full object-cover'
                      />
                    ) : (
                      <UserRound className='size-9 text-muted-foreground' />
                    )}
                  </div>
                  <div>
                    <p className='font-medium'>{name.trim() || '数字人头像'}</p>
                    <p className='text-xs text-muted-foreground'>
                      上传形象图片后自动作为头像展示，也用于生成直播画面。
                    </p>
                  </div>
                </div>

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
                    disabled={isInitializing || editing}
                    onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                  />
                  {editing && editingAvatar ? (
                    <img
                      src={editingAvatar.imageS3Url}
                      alt='preview'
                      className='mt-1 aspect-[9/16] w-24 rounded-lg border object-cover'
                    />
                  ) : imageFile ? (
                    <img
                      src={URL.createObjectURL(imageFile)}
                      alt='preview'
                      className='mt-1 aspect-[9/16] w-24 rounded-lg border object-cover'
                    />
                  ) : null}
                  {editing && (
                    <p className='text-xs text-muted-foreground'>
                      编辑模式不更换形象图片；如需新形象请重新创建。
                    </p>
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

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-category'>直播分类</Label>
                  <Select value={category} onValueChange={setCategory} disabled={isInitializing}>
                    <SelectTrigger id='avatar-category' className='w-full'>
                      <SelectValue placeholder='选择分类' />
                    </SelectTrigger>
                    <SelectContent>
                      {['闲聊', '知识', '娱乐', '游戏', '带货', '其他'].map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-xs text-muted-foreground'>
                    观看端首页按此分类筛选直播。
                  </p>
                </div>

            </CardContent>
          </Card>

          {/* 右：人物设定 */}
          <Card>
            <CardHeader>
              <CardTitle>人物设定</CardTitle>
              <CardDescription>
                这些属性会作为内置提示词注入 AI 对话，观众问起时按设定回答。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-age'>年龄</Label>
                  <Input
                    id='avatar-age'
                    type='number'
                    min={1}
                    max={120}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder='如 25'
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-height'>身高 (cm)</Label>
                  <Input
                    id='avatar-height'
                    type='number'
                    min={1}
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    placeholder='如 165'
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-weight'>体重 (kg)</Label>
                  <Input
                    id='avatar-weight'
                    type='number'
                    min={1}
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    placeholder='如 50'
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-ethnicity'>族裔</Label>
                  <Input
                    id='avatar-ethnicity'
                    value={ethnicity}
                    onChange={(e) => setEthnicity(e.target.value)}
                    placeholder='如 汉族'
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-relationship'>感情状态</Label>
                  <Select
                    value={relationshipStatus}
                    onValueChange={setRelationshipStatus}
                    disabled={isInitializing}
                  >
                    <SelectTrigger id='avatar-relationship' className='w-full'>
                      <SelectValue placeholder='选择感情状态' />
                    </SelectTrigger>
                    <SelectContent>
                      {['单身', '恋爱中', '已婚', '保密'].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='col-span-2 flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-personality'>性格</Label>
                  <Input
                    id='avatar-personality'
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    placeholder='如 活泼开朗、喜欢聊天、偶尔调皮'
                    disabled={isInitializing}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 提交按钮：横跨左右两个设定区域，避免歧义 */}
        <Button type='submit' disabled={submitting || isInitializing} className='w-full'>
          {submitting || isInitializing ? (
            <LoaderCircle className='size-4 animate-spin' />
          ) : (
            <Upload className='size-4' />
          )}
          {isInitializing
            ? '基础视频生成中…'
            : editing
              ? '保存修改'
              : '创建数字人'}
        </Button>
        </form>

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
