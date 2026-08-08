import axios from 'axios'
import {
  Check,
  ChevronRight,
  Cpu,
  Download,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
  Video,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { getRouteApi } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { VideoPlayerDialog } from '@/components/video-player-dialog'
import {
  api,
  updateSceneVideo,
  type Avatar,
  type Scene,
  type SceneVideo,
} from '@/lib/api'

const routeApi = getRouteApi('/_authenticated/scenes/')

// 视频生成阶段时间轴（与 worker 上报的 stage 对应）。
const GENERATION_STAGES = ['download', 'load-models', 'render', 'upload'] as const

// 横向进度时间轴（Flowbite 风格）：圆点图标 + 连接线 + 阶段名/详情/百分比。
function SceneVideoTimeline({ video }: { video: SceneVideo }) {
  const { t } = useTranslation()
  const currentIdx = GENERATION_STAGES.indexOf(
    video.stage as (typeof GENERATION_STAGES)[number],
  )
  const framesMatch = /^\d+\/\d+$/.test(video.stageDetail ?? '')
  const detailText = framesMatch
    ? t('scenes.framesProgress', {
        done: video.stageDetail!.split('/')[0],
        total: video.stageDetail!.split('/')[1],
      })
    : video.stageDetail

  return (
    <div className='mt-3 flex w-full items-center rounded-md border bg-background px-4 py-3'>
      {GENERATION_STAGES.map((stage, index) => {
        const done = index < currentIdx
        const current = index === currentIdx
        const StageIcon =
          stage === 'download'
            ? Download
            : stage === 'load-models'
              ? Cpu
              : stage === 'render'
                ? Video
                : Upload
        return (
          <div key={stage} className='flex flex-1 flex-col'>
            <div className='flex items-center'>
              <div
                className={`h-px flex-1 ${
                  index === 0
                    ? 'bg-transparent'
                    : index - 1 < currentIdx
                      ? 'bg-primary/40'
                      : 'bg-border'
                }`}
              />
              <div
                className={`z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background ${
                  done
                    ? 'bg-primary text-primary-foreground'
                    : current
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? (
                  <Check className='size-4' />
                ) : current ? (
                  <LoaderCircle className='size-4 animate-spin' />
                ) : (
                  <StageIcon className='size-4' />
                )}
              </div>
              {index < GENERATION_STAGES.length - 1 && (
                <div
                  className={`h-px flex-1 ${
                    done ? 'bg-primary/40' : 'bg-border'
                  }`}
                />
              )}
            </div>
            <div className='mt-1.5 flex items-center justify-center gap-1 whitespace-nowrap'>
              <span
                className={`text-xs font-medium ${
                  current ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {t(`scenes.stage.${stage}`)}
              </span>
              {current && detailText && (
                <span className='text-[11px] text-muted-foreground'>
                  {detailText}
                </span>
              )}
              {current && (
                <span className='text-[11px] text-muted-foreground'>
                  {video.progress ?? 0}%
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function showApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? fallback)
    return
  }
  toast.error(fallback)
}

export function ScenesPage() {
  const { t } = useTranslation()
  const { avatarId: searchAvatarId } = routeApi.useSearch()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [selectedAvatarId, setSelectedAvatarId] = useState('')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [expandedSceneId, setExpandedSceneId] = useState<number | null>(null)
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingScene, setEditingScene] = useState<Scene | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteSceneTarget, setDeleteSceneTarget] = useState<Scene | null>(null)
  const [deleteVideoTarget, setDeleteVideoTarget] = useState<SceneVideo | null>(null)
  const [editVideoTarget, setEditVideoTarget] = useState<SceneVideo | null>(null)
  const [editVideoDesc, setEditVideoDesc] = useState('')
  const [editVideoDefault, setEditVideoDefault] = useState(false)
  const [savingVideo, setSavingVideo] = useState(false)

  const loadAvatars = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Avatar[] }>('/avatars')
      setAvatars(data.data)
      setSelectedAvatarId((prev) =>
        prev && data.data.some((a) => String(a.id) === prev)
          ? prev
          : data.data.some((a) => String(a.id) === String(searchAvatarId))
            ? String(searchAvatarId)
            : (data.data[0] ? String(data.data[0].id) : ''),
      )
    } catch {
      // empty state
    }
  }, [searchAvatarId])

  useEffect(() => {
    void loadAvatars()
  }, [loadAvatars])

  const loadScenes = useCallback(async (avatarId: string) => {
    if (!avatarId) {
      setScenes([])
      return
    }
    try {
      const { data } = await api.get<{ data: Scene[] }>(`/avatars/${avatarId}/scenes`)
      setScenes(data.data)
    } catch {
      setScenes([])
    }
  }, [])

  useEffect(() => {
    void loadScenes(selectedAvatarId)
  }, [selectedAvatarId, loadScenes])

  // 生成中视频完成后自动刷新状态。
  useEffect(() => {
    if (!selectedAvatarId) return
    const timer = window.setInterval(() => void loadScenes(selectedAvatarId), 3000)
    return () => window.clearInterval(timer)
  }, [selectedAvatarId, loadScenes])

  // 有视频生成中时，自动展开对应场景，让时间轴可见。
  useEffect(() => {
    const generatingScene = scenes.find((s) =>
      s.videos.some((v) => v.status === 'generating'),
    )
    if (generatingScene && expandedSceneId !== generatingScene.id) {
      setExpandedSceneId(generatingScene.id)
    }
  }, [scenes, expandedSceneId])

  const openCreate = () => {
    setEditingScene(null)
    setTitle('')
    setDescription('')
    setCoverFile(null)
    setDialogOpen(true)
  }

  const openEdit = (scene: Scene) => {
    setEditingScene(scene)
    setTitle(scene.title)
    setDescription(scene.description ?? '')
    setCoverFile(null)
    setDialogOpen(true)
  }

  const saveScene = async () => {
    if (!title.trim() || !selectedAvatarId) {
      toast.error(t('scenes.titleRequired'))
      return
    }
    setSaving(true)
    try {
      const form = new FormData()
      form.append('title', title.trim())
      form.append('description', description.trim())
      if (coverFile) form.append('cover', coverFile)
      if (editingScene) {
        await api.put(`/scenes/${editingScene.id}`, form)
        toast.success(t('scenes.saved'))
      } else {
        await api.post(`/avatars/${selectedAvatarId}/scenes`, form)
        toast.success(t('scenes.created'))
      }
      setDialogOpen(false)
      void loadScenes(selectedAvatarId)
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
    } finally {
      setSaving(false)
    }
  }
  const removeScene = async (scene: Scene) => {
    setDeleteSceneTarget(null)
    try {
      await api.delete(`/scenes/${scene.id}`)
      toast.success(t('scenes.deleted'))
      void loadScenes(selectedAvatarId)
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
    }
  }

  const removeVideo = async (video: SceneVideo) => {
    setDeleteVideoTarget(null)
    try {
      await api.delete(`/scenes/${video.sceneId}/videos/${video.id}`)
      toast.success(t('scenes.videoDeleted'))
      void loadScenes(selectedAvatarId)
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
    }
  }

  const openEditVideo = (video: SceneVideo) => {
    setEditVideoTarget(video)
    setEditVideoDesc(video.description ?? '')
    setEditVideoDefault(video.isDefault)
  }

  const saveVideo = async () => {
    const video = editVideoTarget
    if (!video) return
    if (!editVideoDesc.trim()) {
      toast.error(t('scenes.videoDescRequired'))
      return
    }
    setSavingVideo(true)
    try {
      await updateSceneVideo(video.sceneId, video.id, {
        description: editVideoDesc.trim(),
        isDefault: editVideoDefault,
      })
      toast.success(t('scenes.videoUpdated'))
      setEditVideoTarget(null)
      void loadScenes(selectedAvatarId)
    } catch (error) {
      showApiError(error, t('scenes.videoUpdateFailed'))
    } finally {
      setSavingVideo(false)
    }
  }

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>{t('scenes.title')}</h2>
            <p className='text-muted-foreground'>{t('scenes.subtitle')}</p>
          </div>
          <div className='flex items-center gap-2'>
            <Select value={selectedAvatarId} onValueChange={setSelectedAvatarId}>
              <SelectTrigger className='w-56'>
                <SelectValue placeholder={t('scenes.selectAvatar')} />
              </SelectTrigger>
              <SelectContent>
                {avatars.map((avatar) => (
                  <SelectItem key={avatar.id} value={String(avatar.id)}>
                    {avatar.name} (#{avatar.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={openCreate} disabled={!selectedAvatarId}>
              <Plus className='size-4' />
              {t('scenes.create')}
            </Button>
          </div>
        </div>

        {scenes.length === 0 ? (
          <Card>
            <CardContent className='py-10 text-center text-muted-foreground'>
              {t('scenes.empty')}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-8' />
                    <TableHead className='w-24'>{t('scenes.cover')}</TableHead>
                    <TableHead>{t('scenes.titleLabel')}</TableHead>
                    <TableHead>{t('scenes.descLabel')}</TableHead>
                    <TableHead>{t('scenes.default')}</TableHead>
                    <TableHead>{t('scenes.videoCount')}</TableHead>
                    <TableHead className='text-right'>{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenes.map((scene) => {
                    const expanded = expandedSceneId === scene.id
                    const generatingVideo = scene.videos.find(
                      (v) => v.status === 'generating',
                    )
                    return (
                      <Fragment key={scene.id}>
                        <TableRow
                          className='cursor-pointer'
                          onClick={() =>
                            setExpandedSceneId(expanded ? null : scene.id)
                          }
                        >
                          <TableCell>
                            <ChevronRight
                              className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                            />
                          </TableCell>
                          <TableCell>
                            <img
                              src={scene.coverS3Url}
                              alt={scene.title}
                              className='h-10 w-16 rounded border object-cover'
                            />
                          </TableCell>
                          <TableCell className='font-medium'>{scene.title}</TableCell>
                          <TableCell className='max-w-[260px] truncate text-sm text-muted-foreground'>
                            {scene.description || '-'}
                          </TableCell>
                          <TableCell>
                            {scene.isDefault ? (
                              <Badge variant='secondary'>{t('scenes.default')}</Badge>
                            ) : (
                              <span className='text-sm text-muted-foreground'>-</span>
                            )}
                          </TableCell>
                          <TableCell className='text-sm'>{scene.videos.length}</TableCell>
                          <TableCell className='text-right'>
                            <div
                              className='flex items-center justify-end gap-1'
                              onClick={(e) => e.stopPropagation()}
                            >
                              <a
                                href={`/scenes/add-video?sceneId=${scene.id}&avatarId=${selectedAvatarId}`}
                                className='inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground'
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Plus className='size-3.5' />
                                {t('scenes.addVideos')}
                              </a>
                              <Button
                                size='icon'
                                variant='ghost'
                                className='h-8 w-8'
                                title={t('common.edit')}
                                onClick={() => openEdit(scene)}
                              >
                                <Pencil className='size-3.5' />
                              </Button>
                              <Button
                                size='icon'
                                variant='ghost'
                                className='h-8 w-8 text-destructive'
                                title={t('common.delete')}
                                disabled={scene.isDefault}
                                onClick={() => setDeleteSceneTarget(scene)}
                              >
                                <Trash2 className='size-3.5' />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow>
                            <TableCell colSpan={7} className='bg-muted/30 p-2'>
                              {scene.videos.length === 0 ? (
                                <p className='px-3 py-2 text-sm text-muted-foreground'>
                                  {t('scenes.noVideos')}
                                </p>
                              ) : (
                                <>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className='w-24'>
                                        {t('scenes.defaultVideo')}
                                      </TableHead>
                                      <TableHead className='w-24'>
                                        {t('scenes.source')}
                                      </TableHead>
                                      <TableHead className='w-24'>
                                        {t('scenes.status')}
                                      </TableHead>
                                      <TableHead>{t('scenes.descLabel')}</TableHead>
                                      <TableHead className='text-right'>
                                        {t('common.actions')}
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {scene.videos.map((video) => (
                                      <TableRow key={video.id}>
                                        <TableCell className='w-24'>
                                          {video.isDefault ? (
                                            <Badge variant='secondary'>
                                              {t('scenes.defaultVideo')}
                                            </Badge>
                                          ) : (
                                            <span className='text-sm text-muted-foreground'>
                                              -
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className='w-24'>
                                          <span className='text-xs text-muted-foreground'>
                                            {video.source === 'upload'
                                              ? t('scenes.sourceUpload')
                                              : video.source === 'liveportrait'
                                                ? 'LivePortrait'
                                                : video.source}
                                          </span>
                                        </TableCell>
                                        <TableCell className='w-24'>
                                          <div className='flex flex-col items-start gap-1'>
                                            {video.status === 'ready' && (
                                              <Badge variant='secondary'>
                                                {t('common.ready')}
                                              </Badge>
                                            )}
                                            {video.status === 'generating' && (
                                              <Badge variant='default'>
                                                {t('scenes.generating')}
                                              </Badge>
                                            )}
                                            {video.status === 'failed' && (
                                              <Badge variant='destructive'>
                                                {t('common.failed')}
                                              </Badge>
                                            )}
                                            {video.status === 'failed' &&
                                              video.errorMessage && (
                                                <span className='max-w-[200px] truncate text-xs text-destructive'>
                                                  {video.errorMessage}
                                                </span>
                                              )}
                                          </div>
                                        </TableCell>
                                        <TableCell>
                                          {video.description ||
                                            (video.isDefault
                                              ? t('scenes.defaultVideo')
                                              : `#${video.id}`)}
                                        </TableCell>
                                        <TableCell className='text-right'>
                                          <div className='flex items-center justify-end gap-1'>
                                            <Button
                                              size='icon'
                                              variant='ghost'
                                              className='h-7 w-7'
                                              title={t('common.edit')}
                                              onClick={() => openEditVideo(video)}
                                            >
                                              <Pencil className='size-3.5' />
                                            </Button>
                                            <Button
                                              size='icon'
                                              variant='ghost'
                                              className='h-7 w-7'
                                              title={t('common.play')}
                                              disabled={
                                                video.status !== 'ready' ||
                                                !video.s3Url
                                              }
                                              onClick={() => setPlayUrl(video.s3Url)}
                                            >
                                              <Play className='size-3.5' />
                                            </Button>
                                            <Button
                                              size='icon'
                                              variant='ghost'
                                              className='h-7 w-7 text-destructive'
                                              title={t('common.delete')}
                                              disabled={video.isDefault}
                                              onClick={() => setDeleteVideoTarget(video)}
                                            >
                                              <Trash2 className='size-3.5' />
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                {generatingVideo && (
                                  <SceneVideoTimeline video={generatingVideo} />
                                )}
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingScene ? t('scenes.editTitle') : t('scenes.createTitle')}
              </DialogTitle>
              <DialogDescription>{t('scenes.dialogDesc')}</DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-3'>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='scene-title'>{t('scenes.titleLabel')}</Label>
                <Input
                  id='scene-title'
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('scenes.titlePlaceholder')}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='scene-desc'>{t('scenes.descLabel')}</Label>
                <Input
                  id='scene-desc'
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('scenes.descPlaceholder')}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='scene-cover'>{t('scenes.coverLabel')}</Label>
                <Input
                  id='scene-cover'
                  type='file'
                  accept='image/*'
                  onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void saveScene()} disabled={saving}>
                {saving && <LoaderCircle className='size-4 animate-spin' />}
                {editingScene ? t('scenes.save') : t('scenes.create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 编辑视频：修改描述 / 设为默认视频 */}
        <Dialog
          open={editVideoTarget !== null}
          onOpenChange={(open) => !open && setEditVideoTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('scenes.editVideoTitle')}</DialogTitle>
              <DialogDescription>{t('scenes.editVideoDesc')}</DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-3'>
              <div className='flex flex-col gap-1.5'>
                <Label>{t('scenes.videoDescLabel')}</Label>
                <Input
                  value={editVideoDesc}
                  onChange={(e) => setEditVideoDesc(e.target.value)}
                  placeholder={t('scenes.videoDescPlaceholder')}
                />
              </div>
              <label className='flex cursor-pointer items-center gap-2 text-sm'>
                <Checkbox
                  checked={editVideoDefault}
                  disabled={editVideoTarget?.isDefault}
                  onCheckedChange={(v) => setEditVideoDefault(Boolean(v))}
                />
                <span>{t('scenes.setDefaultVideo')}</span>
              </label>
              {editVideoTarget?.isDefault && (
                <p className='text-xs text-muted-foreground'>
                  {t('scenes.currentDefaultVideo')}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setEditVideoTarget(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void saveVideo()} disabled={savingVideo}>
                {savingVideo && <LoaderCircle className='size-4 animate-spin' />}
                {t('scenes.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <VideoPlayerDialog
          open={playUrl !== null}
          url={playUrl ?? undefined}
          title={t('scenes.videoPreview')}
          onClose={() => setPlayUrl(null)}
        />

        <ConfirmDialog
          open={Boolean(deleteSceneTarget)}
          onOpenChange={(open) => !open && setDeleteSceneTarget(null)}
          title={t('scenes.deleteSceneTitle')}
          desc={t('scenes.deleteSceneDesc')}
          destructive
          confirmText={t('common.delete')}
          cancelBtnText={t('common.cancel')}
          handleConfirm={() => deleteSceneTarget && void removeScene(deleteSceneTarget)}
        />
        <ConfirmDialog
          open={Boolean(deleteVideoTarget)}
          onOpenChange={(open) => !open && setDeleteVideoTarget(null)}
          title={t('scenes.deleteVideoTitle')}
          desc={t('scenes.deleteVideoDesc')}
          destructive
          confirmText={t('common.delete')}
          cancelBtnText={t('common.cancel')}
          handleConfirm={() => deleteVideoTarget && void removeVideo(deleteVideoTarget)}
        />
      </Main>
    </>
  )
}
