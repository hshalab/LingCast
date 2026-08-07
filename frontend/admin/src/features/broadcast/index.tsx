import axios from 'axios'
import { Download, LoaderCircle, Play, RotateCcw, Send, Trash2, Upload } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
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
import { TaskProgress } from '@/components/task-progress'
import { ConfirmDialog } from '@/components/confirm-dialog'
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
import { api, type Avatar, type BroadcastTask, type Scene } from '@/lib/api'

function showApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? fallback)
    return
  }
  toast.error(fallback)
}

const TASK_STATUS_KEY: Record<BroadcastTask['status'], string> = {
  pending: 'common.pending',
  processing: 'common.processing',
  completed: 'common.completed',
  failed: 'common.failed',
}

const TASK_STATUS_VARIANT: Record<
  BroadcastTask['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  pending: 'secondary',
  processing: 'default',
  completed: 'secondary',
  failed: 'destructive',
}

const TASK_STAGE_KEY: Record<string, string> = {
  tts: 'task.stage.tts',
  lipsync: 'task.stage.lipsync',
  mux: 'task.stage.mux',
}

function statusVariant(status: BroadcastTask['status']) {
  return TASK_STATUS_VARIANT[status]
}

function formatTime(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(locale, { hour12: false })
}

export function Broadcast({
  initialAvatarId,
  initialTaskId,
}: {
  initialAvatarId?: string
  initialTaskId?: string
}) {
  const { t, i18n } = useTranslation()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [history, setHistory] = useState<BroadcastTask[]>([])
  const [selectedAvatarId, setSelectedAvatarId] = useState('')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState('')
  const [selectedVideoId, setSelectedVideoId] = useState('')
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [script, setScript] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<BroadcastTask | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const historyRef = useRef<HTMLDivElement>(null)
  const selectedAvatar = avatars.find((a) => String(a.id) === selectedAvatarId)
  const readyAvatars = avatars.filter((avatar) => avatar.status === 'ready')
  const locale = i18n.language === 'en' ? 'en-US' : 'zh-CN'
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

  const loadScenes = useCallback(async (avatarId: string) => {
    if (!avatarId) {
      setScenes([])
      setSelectedSceneId('')
      setSelectedVideoId('')
      return
    }
    try {
      const { data } = await api.get<{ data: Scene[] }>(
        `/avatars/${avatarId}/scenes`,
      )
      setScenes(data.data)
      setSelectedSceneId((prev) =>
        prev && data.data.some((s) => String(s.id) === prev)
          ? prev
          : (data.data[0] ? String(data.data[0].id) : ''),
      )
    } catch {
      setScenes([])
      setSelectedSceneId('')
      setSelectedVideoId('')
    }
  }, [])

  const selectedScene = scenes.find((s) => String(s.id) === selectedSceneId)

  // When the scene changes, pick its default (or first) video.
  useEffect(() => {
    const videos = selectedScene?.videos ?? []
    const def = videos.find((v) => v.isDefault) ?? videos[0]
    setSelectedVideoId(def ? String(def.id) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSceneId])

  useEffect(() => {
    void loadScenes(selectedAvatarId)
  }, [selectedAvatarId, loadScenes])

  const handleVideoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selectedSceneId) return
    setUploadingVideo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('description', file.name)
      await api.post(`/scenes/${selectedSceneId}/videos`, form)
      await loadScenes(selectedAvatarId)
      toast.success(t('broadcast.videoUploaded'))
    } catch (error) {
      showApiError(error, t('broadcast.videoUploadFailed'))
    } finally {
      setUploadingVideo(false)
    }
  }

  const handleRetry = async (task: BroadcastTask) => {
    try {
      await api.post(`/tasks/${task.id}/retry`)
      toast.success(t('task.toastTaskRequeued', { id: task.id }))
      void loadHistory()
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
    }
  }

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
      toast.error(t('broadcast.toastSelectAvatar'))
      return
    }
    if (!script.trim()) {
      toast.error(t('broadcast.toastScriptRequired'))
      return
    }
    setSubmitting(true)
    try {
      await api.post<BroadcastTask>('/tasks', {
        avatarId: Number(selectedAvatarId),
        scriptText: script.trim(),
        sceneId: selectedSceneId ? Number(selectedSceneId) : undefined,
        videoId: selectedVideoId ? Number(selectedVideoId) : undefined,
      })
      void loadHistory()
      setScript('')
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
    } finally {
      setSubmitting(false)
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
          <h2 className='text-2xl font-bold tracking-tight'>{t('broadcast.title')}</h2>
          <p className='text-muted-foreground'>{t('broadcast.subtitle')}</p>
        </div>

        {readyAvatars.length === 0 ? (
          <Card>
            <CardHeader className='items-center text-center'>
              <CardTitle>{t('broadcast.noReady')}</CardTitle>
              <CardDescription>{t('broadcast.noReadyDesc')}</CardDescription>
            </CardHeader>
            <CardContent className='flex justify-center'>
              <Button asChild>
                <Link to='/avatar-studio' search={{ edit: undefined }}>
                  {t('broadcast.goCreate')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t('broadcast.configTitle')}</CardTitle>
              <CardDescription>{t('broadcast.configDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className='flex flex-col gap-5'>
                {/* 横向平铺：左 = 选择数字人，右 = 播报脚本 */}
                <div className='grid gap-5 lg:grid-cols-2'>
                  <div className='flex flex-col gap-2'>
                    <Label htmlFor='avatar-select'>{t('broadcast.selectAvatar')}</Label>
                    <Select value={selectedAvatarId} onValueChange={setSelectedAvatarId}>
                      <SelectTrigger id='avatar-select' className='w-full'>
                        <SelectValue placeholder={t('broadcast.selectAvatar')} />
                      </SelectTrigger>
                      <SelectContent>
                        {avatars.map((avatar) => (
                          <SelectItem
                            key={avatar.id}
                            value={String(avatar.id)}
                            disabled={avatar.status !== 'ready'}
                          >
                            {avatar.name} (#{avatar.id})
                            {avatar.status !== 'ready' ? ` · ${t('common.generating')}` : ''}
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
                          <p className='truncate font-medium'>
                            {selectedAvatar.name} (#{selectedAvatar.id})
                          </p>
                          <p className='truncate text-muted-foreground'>
                            {t('broadcast.voice', { voice: selectedVoiceLabel })}
                          </p>
                        </div>
                      </div>
                    )}
                    {/* 场景 -> 视频 两级选择 */}
                    <Label htmlFor='scene-select' className='mt-2'>
                      {t('broadcast.selectScene')}
                    </Label>
                    <Select
                      value={selectedSceneId}
                      onValueChange={setSelectedSceneId}
                      disabled={scenes.length === 0}
                    >
                      <SelectTrigger id='scene-select' className='w-full'>
                        <SelectValue placeholder={t('broadcast.selectScene')} />
                      </SelectTrigger>
                      <SelectContent>
                        {scenes.map((scene) => (
                          <SelectItem key={scene.id} value={String(scene.id)}>
                            {scene.isDefault
                              ? t('broadcast.defaultSceneName')
                              : scene.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Label htmlFor='video-select' className='mt-2'>
                      {t('broadcast.selectVideo')}
                    </Label>
                    <div className='flex items-center gap-2'>
                      <Select
                        value={selectedVideoId}
                        onValueChange={setSelectedVideoId}
                        disabled={!selectedScene || selectedScene.videos.length === 0}
                      >
                        <SelectTrigger id='video-select' className='w-full'>
                          <SelectValue placeholder={t('broadcast.selectVideo')} />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedScene?.videos ?? []).map((video) => (
                            <SelectItem key={video.id} value={String(video.id)}>
                              {video.description ||
                                (video.isDefault
                                  ? t('broadcast.defaultVideoName')
                                  : `#${video.id}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type='button'
                        variant='outline'
                        size='icon'
                        className='shrink-0'
                        disabled={uploadingVideo || !selectedSceneId}
                        title={t('broadcast.uploadVideo')}
                        onClick={() => videoInputRef.current?.click()}
                      >
                        {uploadingVideo ? (
                          <LoaderCircle className='size-4 animate-spin' />
                        ) : (
                          <Upload className='size-4' />
                        )}
                      </Button>
                      <input
                        ref={videoInputRef}
                        type='file'
                        accept='video/*,.mp4,.mov,.webm,.mkv,.avi'
                        className='hidden'
                        onChange={handleVideoFile}
                      />
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      {t('broadcast.videoHint')}
                    </p>
                  </div>

                  <div className='flex flex-col gap-2'>
                    <Label htmlFor='script'>{t('broadcast.script')}</Label>
                    <Textarea
                      id='script'
                      value={script}
                      onChange={(event) => setScript(event.target.value)}
                      placeholder={t('broadcast.scriptPlaceholder')}
                      rows={6}
                    />
                  </div>
                </div>

                <Button
                  type='submit'
                  disabled={submitting || !selectedAvatarId || !script.trim()}
                >
                  {submitting ? (
                    <LoaderCircle className='size-4 animate-spin' />
                  ) : (
                    <Send className='size-4' />
                  )}
                  {t('broadcast.submit')}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className='gap-1'>
            <CardTitle>{t('broadcast.historyTitle')}</CardTitle>
            <CardDescription>{t('broadcast.historyDesc')}</CardDescription>
          </CardHeader>
          <CardContent ref={historyRef}>
            {history.length === 0 ? (
              <p className='py-6 text-center text-sm text-muted-foreground'>
                {t('broadcast.historyEmpty')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t('broadcast.colAvatar')}</TableHead>
                    <TableHead>{t('broadcast.colScene')}</TableHead>
                    <TableHead>{t('broadcast.colVideo')}</TableHead>
                    <TableHead>{t('broadcast.colScript')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('common.createdAt')}</TableHead>
                    <TableHead className='text-right'>{t('broadcast.colOutput')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((item) => {
                    const statusLabel = t(TASK_STATUS_KEY[item.status])
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
                        <TableCell>{item.sceneName || '-'}</TableCell>
                        <TableCell>{item.videoName || '-'}</TableCell>
                        <TableCell className='max-w-[280px] truncate' title={item.scriptText}>
                          {item.scriptText}
                        </TableCell>
                        <TableCell>
                          {item.status === 'processing' && item.progress !== undefined ? (
                            <TaskProgress
                              value={item.progress}
                              label={t(TASK_STAGE_KEY[item.stage ?? 'tts'])}
                            />
                          ) : (
                            <Badge variant={statusVariant(item.status)}>{statusLabel}</Badge>
                          )}
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-sm text-muted-foreground'>
                          {formatTime(item.createdAt, locale)}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex items-center justify-end gap-1'>
                            {item.status === 'completed' && item.outputVideoS3Url ? (
                              <>
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => setPlayUrl(item.outputVideoS3Url!)}
                              >
                                <Play className='size-3.5' />
                                {t('common.play')}
                              </Button>
                              <Button asChild variant='outline' size='sm'>
                                <a
                                  href={item.outputVideoS3Url}
                                  download
                                  target='_blank'
                                  rel='noreferrer'
                                >
                                  <Download className='size-3.5' />
                                  {t('common.download')}
                                </a>
                              </Button>
                              </>
                            )}
                            {(item.status === 'failed' || item.status === 'processing') && (
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => void handleRetry(item)}
                              >
                                <RotateCcw className='size-3.5' />
                                {t('common.retry')}
                              </Button>
                            )}
                            <Button
                              variant='ghost'
                              size='sm'
                              className='text-destructive'
                              onClick={() => setDeleteTaskTarget(item)}
                            >
                              <Trash2 className='size-3.5' />
                              {t('common.delete')}
                            </Button>
                          </div>
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
          title={t('broadcast.resultTitle')}
          onClose={() => setPlayUrl(null)}
        />
        <ConfirmDialog
          open={Boolean(deleteTaskTarget)}
          onOpenChange={(open) => !open && setDeleteTaskTarget(null)}
          title={t('task.confirmDeleteTaskTitle')}
          desc={
            deleteTaskTarget
              ? t('task.confirmDeleteTask', { id: deleteTaskTarget.id })
              : ''
          }
          destructive
          confirmText={t('common.delete')}
          cancelBtnText={t('common.cancel')}
          handleConfirm={async () => {
            const target = deleteTaskTarget
            setDeleteTaskTarget(null)
            if (!target) return
            try {
              await api.delete(`/tasks/${target.id}`)
              toast.success(t('task.toastTaskDeleted', { id: target.id }))
              void loadHistory()
            } catch (error) {
              showApiError(error, t('common.requestFailed'))
            }
          }}
        />
      </Main>
    </>
  )
}
