import axios from 'axios'
import { CheckCircle2, LoaderCircle, Play, Upload, UserRound, Volume2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
import { KnowledgePanel } from '@/features/knowledge/knowledge-panel'
import {
  cacheVoices,
  DEFAULT_VOICE_ID,
  getCachedVoices,
  type EdgeVoice,
} from './voices'

function showApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? fallback)
    return
  }
  toast.error(fallback)
}

const PREVIEW_TEXT = '你好，我是你的数字人助理，很高兴认识你。'

const CATEGORY_KEY: Record<string, string> = {
  闲聊: 'chat',
  知识: 'knowledge',
  娱乐: 'entertainment',
  游戏: 'game',
  带货: 'sales',
  其他: 'other',
}

const RELATIONSHIP_KEY: Record<string, string> = {
  单身: 'single',
  恋爱中: 'dating',
  已婚: 'married',
  保密: 'private',
}

const routeApi = getRouteApi('/_authenticated/avatar-studio')

export function AvatarStudio() {
  const { t } = useTranslation()
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
      .catch(() => toast.error(t('studio.toastLoadFailed')))
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
      toast.success(t('studio.toastReady'))
    }
    if (created?.status === 'failed') {
      setInitFailed(true)
      toast.error(t('studio.toastInitFailed'))
    }
  }, [created?.status])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      toast.error(t('studio.toastNameRequired'))
      return
    }
    if (!editing && !imageFile) {
      toast.error(t('studio.toastImageRequired'))
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
        toast.success(t('studio.toastUpdated'))
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
      toast.info(t('studio.toastSubmitted'))
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
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
      toast.info(t('studio.toastPreviewing'))
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
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
          <h2 className='text-2xl font-bold tracking-tight'>{t('studio.title')}</h2>
          <p className='text-muted-foreground'>{t('studio.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
        <div className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>
                {editing ? t('studio.editTitle') : t('studio.createTitle')}
              </CardTitle>
              <CardDescription>
                {editing ? t('studio.editDesc') : t('studio.createDesc')}
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
                    <p className='font-medium'>{name.trim() || t('studio.avatarPreview')}</p>
                    <p className='text-xs text-muted-foreground'>
                      {t('studio.avatarHint')}
                    </p>
                  </div>
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-name'>{t('studio.avatarName')}</Label>
                  <Input
                    id='avatar-name'
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('studio.avatarNamePlaceholder')}
                    disabled={isInitializing}
                  />
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-image'>{t('studio.avatarImage')}</Label>
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
                      {t('studio.editNoImage')}
                    </p>
                  )}
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-voice'>{t('studio.voice')}</Label>
                  <div className='flex items-center gap-2'>
                    <Select value={voiceId} onValueChange={setVoiceId} disabled={isInitializing}>
                      <SelectTrigger id='avatar-voice' className='w-full'>
                        <SelectValue placeholder={t('studio.voicePlaceholder')} />
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
                      title={t('studio.previewVoice', {
                        voice: selectedVoice?.label ?? voiceId,
                      })}
                    >
                      {previewing ? (
                        <LoaderCircle className='size-4 animate-spin' />
                      ) : (
                        <Volume2 className='size-4' />
                      )}
                    </Button>
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {t('studio.currentVoice', { voice: selectedVoice?.label ?? voiceId })}
                  </p>
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='avatar-category'>{t('studio.category')}</Label>
                  <Select value={category} onValueChange={setCategory} disabled={isInitializing}>
                    <SelectTrigger id='avatar-category' className='w-full'>
                    <SelectValue placeholder={t('studio.categoryPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {['闲聊', '知识', '娱乐', '游戏', '带货', '其他'].map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`category.${CATEGORY_KEY[c]}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-xs text-muted-foreground'>
                    {t('studio.categoryHint')}
                  </p>
                </div>

            </CardContent>
          </Card>

          {/* 右：人物设定 */}
          <Card>
            <CardHeader>
              <CardTitle>{t('studio.persona')}</CardTitle>
              <CardDescription>{t('studio.personaDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-age'>{t('studio.age')}</Label>
                  <Input
                    id='avatar-age'
                    type='number'
                    min={1}
                    max={120}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder={t('studio.agePlaceholder')}
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-height'>{t('studio.height')}</Label>
                  <Input
                    id='avatar-height'
                    type='number'
                    min={1}
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    placeholder={t('studio.heightPlaceholder')}
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-weight'>{t('studio.weight')}</Label>
                  <Input
                    id='avatar-weight'
                    type='number'
                    min={1}
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    placeholder={t('studio.weightPlaceholder')}
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-ethnicity'>{t('studio.ethnicity')}</Label>
                  <Input
                    id='avatar-ethnicity'
                    value={ethnicity}
                    onChange={(e) => setEthnicity(e.target.value)}
                    placeholder={t('studio.ethnicityPlaceholder')}
                    disabled={isInitializing}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-relationship'>{t('studio.relationship')}</Label>
                  <Select
                    value={relationshipStatus}
                    onValueChange={setRelationshipStatus}
                    disabled={isInitializing}
                  >
                    <SelectTrigger id='avatar-relationship' className='w-full'>
                      <SelectValue placeholder={t('studio.relationshipPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {['单身', '恋爱中', '已婚', '保密'].map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`relationship.${RELATIONSHIP_KEY[s]}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='col-span-2 flex flex-col gap-1.5'>
                  <Label htmlFor='avatar-personality'>{t('studio.personality')}</Label>
                  <Input
                    id='avatar-personality'
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    placeholder={t('studio.personalityPlaceholder')}
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
            ? t('studio.generating')
            : editing
              ? t('studio.submitSave')
              : t('studio.submitCreate')}
        </Button>
        </form>

        {/* 私有知识库：仅在编辑模式显示（按 avatar 严格隔离） */}
        {editing && editingAvatar && (
          <KnowledgePanel avatarId={Number(editId)} />
        )}

          {isInitializing && (
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <LoaderCircle className='size-5 animate-spin' />
                  {t('studio.generatingTitle')}
                </CardTitle>
                <CardDescription>{t('studio.generatingDesc')}</CardDescription>
              </CardHeader>
              <CardContent className='flex items-center gap-2'>
                <Badge variant='secondary'>{t('studio.initializing')}</Badge>
                <span className='text-sm text-muted-foreground'>
                  {t('studio.generatingHint')}
                </span>
              </CardContent>
            </Card>
          )}

          {created?.status === 'ready' && (
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-green-600'>
                  <CheckCircle2 className='size-5' />
                  {t('studio.createdTitle')}
                </CardTitle>
                <CardDescription>
                  {t('studio.createdDesc', { name: created.name })}
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
                    {t('studio.playDefault')}
                  </Button>
                )}
                <div className='flex gap-2'>
                  <Button asChild>
                    <Link to='/broadcast' search={{ avatarId: String(created.id) }}>
                      {t('studio.goBroadcast')}
                    </Link>
                  </Button>
                  <Button asChild variant='outline'>
                    <Link to='/avatar-library'>{t('studio.goList')}</Link>
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
                  {t('studio.failedTitle')}
                </CardTitle>
                <CardDescription>{t('studio.failedDesc')}</CardDescription>
              </CardHeader>
            </Card>
          )}

        <VideoPlayerDialog
          open={previewOpen}
          url={created?.baseVideoS3Url}
          title={`${created?.name ?? ''} · ${t('studio.defaultVideo')}`}
          onClose={() => setPreviewOpen(false)}
        />
      </Main>
    </>
  )
}
