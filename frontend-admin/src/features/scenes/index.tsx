import axios from 'axios'
import {
  ChevronRight,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
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
import { api, type Avatar, type Scene, type SceneVideo } from '@/lib/api'

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
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)
  const [videoScene, setVideoScene] = useState<Scene | null>(null)
  const [videoRows, setVideoRows] = useState<
    { file: File | null; description: string }[]
  >([{ file: null, description: '' }])
  const [uploadingVideos, setUploadingVideos] = useState(false)
  const [deleteSceneTarget, setDeleteSceneTarget] = useState<Scene | null>(null)
  const [deleteVideoTarget, setDeleteVideoTarget] = useState<SceneVideo | null>(null)

  const loadAvatars = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Avatar[] }>('/avatars')
      setAvatars(data.data)
      setSelectedAvatarId((prev) =>
        prev && data.data.some((a) => String(a.id) === prev)
          ? prev
          : (data.data[0] ? String(data.data[0].id) : ''),
      )
    } catch {
      // empty state
    }
  }, [])

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

  const openVideoDialog = (scene: Scene) => {
    setVideoScene(scene)
    setVideoRows([{ file: null, description: '' }])
    setVideoDialogOpen(true)
  }

  const addVideoRow = () => {
    setVideoRows((rows) => [...rows, { file: null, description: '' }])
  }

  const updateVideoRow = (
    index: number,
    patch: Partial<{ file: File | null; description: string }>,
  ) => {
    setVideoRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  const uploadVideos = async () => {
    const scene = videoScene
    const pending = videoRows.filter((row) => row.file)
    if (!scene || pending.length === 0) {
      toast.error(t('scenes.videoFileRequired'))
      return
    }
    setUploadingVideos(true)
    try {
      let done = 0
      for (const row of pending) {
        const form = new FormData()
        form.append('file', row.file!)
        form.append('description', row.description.trim() || row.file!.name)
        await api.post(`/scenes/${scene.id}/videos`, form)
        done += 1
      }
      toast.success(t('scenes.videoUploadedMany', { count: done }))
      setVideoDialogOpen(false)
      void loadScenes(selectedAvatarId)
    } catch (error) {
      showApiError(error, t('scenes.videoUploadFailed'))
    } finally {
      setUploadingVideos(false)
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
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => openVideoDialog(scene)}
                              >
                                <Plus className='size-3.5' />
                                {t('scenes.addVideos')}
                              </Button>
                              <Button
                                size='icon'
                                variant='ghost'
                                className='h-8 w-8'
                                title={t('common.edit')}
                                onClick={() => openEdit(scene)}
                              >
                                <Pencil className='size-3.5' />
                              </Button>
                              {!scene.isDefault && (
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='h-8 w-8 text-destructive'
                                  title={t('common.delete')}
                                  onClick={() => setDeleteSceneTarget(scene)}
                                >
                                  <Trash2 className='size-3.5' />
                                </Button>
                              )}
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
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t('scenes.descLabel')}</TableHead>
                                      <TableHead>{t('scenes.default')}</TableHead>
                                      <TableHead className='text-right'>
                                        {t('common.actions')}
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {scene.videos.map((video) => (
                                      <TableRow key={video.id}>
                                        <TableCell>
                                          {video.description ||
                                            (video.isDefault
                                              ? t('scenes.defaultVideo')
                                              : `#${video.id}`)}
                                        </TableCell>
                                        <TableCell>
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
                                        <TableCell className='text-right'>
                                          <div className='flex items-center justify-end gap-1'>
                                            <Button
                                              size='icon'
                                              variant='ghost'
                                              className='h-7 w-7'
                                              title={t('common.play')}
                                              onClick={() => setPlayUrl(video.s3Url)}
                                            >
                                              <Play className='size-3.5' />
                                            </Button>
                                            {!video.isDefault && (
                                              <Button
                                                size='icon'
                                                variant='ghost'
                                                className='h-7 w-7 text-destructive'
                                                title={t('common.delete')}
                                                onClick={() => setDeleteVideoTarget(video)}
                                              >
                                                <Trash2 className='size-3.5' />
                                              </Button>
                                            )}
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
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

        {/* 批量添加视频：多行「视频文件 + 描述」组合 */}
        <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
          <DialogContent className='max-h-[80vh] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle>
                {t('scenes.addVideosTitle')}
                {videoScene ? ` · ${videoScene.title}` : ''}
              </DialogTitle>
              <DialogDescription>{t('scenes.addVideosDesc')}</DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-3'>
              {videoRows.map((row, index) => (
                <div
                  key={index}
                  className='flex items-start gap-2 rounded-md border p-2'
                >
                  <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                    <Input
                      type='file'
                      accept='video/*,.mp4,.mov,.webm,.mkv,.avi'
                      onChange={(e) =>
                        updateVideoRow(index, { file: e.target.files?.[0] ?? null })
                      }
                    />
                    <Input
                      value={row.description}
                      onChange={(e) =>
                        updateVideoRow(index, { description: e.target.value })
                      }
                      placeholder={t('scenes.videoDescPlaceholder')}
                    />
                  </div>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8 shrink-0 text-destructive'
                    disabled={videoRows.length === 1}
                    onClick={() =>
                      setVideoRows((rows) => rows.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                </div>
              ))}
              <Button variant='outline' size='sm' onClick={addVideoRow}>
                <Plus className='size-3.5' />
                {t('scenes.addRow')}
              </Button>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setVideoDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void uploadVideos()} disabled={uploadingVideos}>
                {uploadingVideos && <LoaderCircle className='size-4 animate-spin' />}
                {t('scenes.upload')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
