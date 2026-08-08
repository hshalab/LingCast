import axios from 'axios'
import { ArrowLeft, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { Component, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  api,
  generateSceneVideo,
  getAvatarDefaults,
  type LivePortraitSettings,
  type Scene,
} from '@/lib/api'
import {
  BLINK_IDLE_SETTINGS,
  DEFAULT_LIVEPORTRAIT_SETTINGS,
  LivePortraitSettingsPanel,
} from '@/components/liveportrait-settings'

function showApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? fallback)
    return
  }
  toast.error(fallback)
}

class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <Main className='flex flex-col items-center justify-center gap-3 py-16'>
          <p className='font-medium text-destructive'>页面渲染出错</p>
          <pre className='max-w-full overflow-auto rounded-md border bg-muted p-3 text-xs'>
            {String(this.state.error.message || this.state.error)}
          </pre>
        </Main>
      )
    }
    return this.props.children
  }
}

function SceneVideoAddPageInner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const routeApi = getRouteApi('/_authenticated/scenes/add-video')
  const { sceneId, avatarId } = routeApi.useSearch()

  const [scene, setScene] = useState<Scene | null>(null)
  const [loading, setLoading] = useState(true)
  const [videoTab, setVideoTab] = useState<'upload' | 'liveportrait' | 'other'>(
    'upload',
  )
  const [videoRows, setVideoRows] = useState<
    { file: File | null; description: string }[]
  >([{ file: null, description: '' }])
  const [uploadingVideos, setUploadingVideos] = useState(false)
  const [lpDesc, setLpDesc] = useState('')
  const [lpImage, setLpImage] = useState<File | null>(null)
  const [lpSettings, setLpSettings] = useState<LivePortraitSettings>(
    DEFAULT_LIVEPORTRAIT_SETTINGS,
  )
  const [showParams, setShowParams] = useState(false)
  const [generating, setGenerating] = useState(false)

  const goBack = () =>
    void navigate({ to: '/scenes', search: { avatarId } })

  // 加载场景（用于标题展示）。
  useEffect(() => {
    if (!sceneId || !avatarId) {
      setLoading(false)
      return
    }
    void api
      .get<{ data: Scene[] }>(`/avatars/${avatarId}/scenes`)
      .then(({ data }) => {
        setScene(data.data.find((s) => s.id === sceneId) ?? null)
      })
      .catch(() => toast.error(t('scenes.loadFailed')))
      .finally(() => setLoading(false))
  }, [sceneId, avatarId, t])

  // 按 Worker 上报的硬件能力选择默认驱动模板。
  useEffect(() => {
    void getAvatarDefaults()
      .then((defaults) => {
        if (defaults.drivingTemplate) {
          setLpSettings((prev) => ({
            ...prev,
            drivingTemplate: defaults.drivingTemplate!,
          }))
        }
      })
      .catch(() => {
        // 保持内置默认值
      })
  }, [])

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
    if (!scene) return
    const pending = videoRows.filter((row) => row.file)
    if (pending.length === 0) {
      toast.error(t('scenes.videoFileRequired'))
      return
    }
    if (videoRows.some((row) => row.file && !row.description.trim())) {
      toast.error(t('scenes.videoDescRequired'))
      return
    }
    setUploadingVideos(true)
    try {
      let done = 0
      for (const row of pending) {
        const form = new FormData()
        form.append('file', row.file!)
        form.append('description', row.description.trim())
        await api.post(`/scenes/${scene.id}/videos`, form)
        done += 1
      }
      toast.success(t('scenes.videoUploadedMany', { count: done }))
      goBack()
    } catch (error) {
      showApiError(error, t('scenes.videoUploadFailed'))
    } finally {
      setUploadingVideos(false)
    }
  }

  const submitLivePortrait = async () => {
    if (!scene) return
    if (!lpDesc.trim()) {
      toast.error(t('scenes.videoDescRequired'))
      return
    }
    if (!lpImage) {
      toast.error(t('scenes.videoImageRequired'))
      return
    }
    setGenerating(true)
    try {
      await generateSceneVideo(scene.id, {
        description: lpDesc.trim(),
        image: lpImage,
        settings: lpSettings,
      })
      toast.success(t('scenes.videoGenSubmitted'))
      goBack()
    } catch (error) {
      showApiError(error, t('scenes.videoGenFailed'))
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <Main className='flex items-center justify-center'>
        <LoaderCircle className='size-6 animate-spin text-muted-foreground' />
      </Main>
    )
  }

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              {t('scenes.addVideosTitle')}
              {scene ? ` · ${scene.title}` : ''}
            </h2>
            <p className='text-muted-foreground'>{t('scenes.addVideosDesc')}</p>
          </div>
          <Button variant='outline' onClick={goBack}>
            <ArrowLeft className='size-4' />
            {t('common.back')}
          </Button>
        </div>

        <Card>
          <CardContent className='pt-6'>
            {!scene ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                {t('scenes.sceneMissing')}
              </p>
            ) : (
              <Tabs
                value={videoTab}
                onValueChange={(v) =>
                  setVideoTab(v as 'upload' | 'liveportrait' | 'other')
                }
              >
                <TabsList className='grid w-full max-w-md grid-cols-3'>
                  <TabsTrigger value='upload'>{t('scenes.tabUpload')}</TabsTrigger>
                  <TabsTrigger value='liveportrait'>
                    {t('scenes.tabLivePortrait')}
                  </TabsTrigger>
                  <TabsTrigger value='other'>{t('scenes.tabOther')}</TabsTrigger>
                </TabsList>

                <TabsContent value='upload' className='mt-4 flex flex-col gap-3'>
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
                            updateVideoRow(index, {
                              file: e.target.files?.[0] ?? null,
                            })
                          }
                        />
                        <Input
                          value={row.description}
                          onChange={(e) =>
                            updateVideoRow(index, {
                              description: e.target.value,
                            })
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
                          setVideoRows((rows) =>
                            rows.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 className='size-3.5' />
                      </Button>
                    </div>
                  ))}
                  <div className='flex gap-2'>
                    <Button variant='outline' size='sm' onClick={addVideoRow}>
                      <Plus className='size-3.5' />
                      {t('scenes.addRow')}
                    </Button>
                    <div className='ms-auto flex gap-2'>
                      <Button variant='outline' onClick={goBack}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        onClick={() => void uploadVideos()}
                        disabled={uploadingVideos}
                      >
                        {uploadingVideos && (
                          <LoaderCircle className='size-4 animate-spin' />
                        )}
                        {t('scenes.upload')}
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value='liveportrait' className='mt-4 flex flex-col gap-3'>
                  {/* 形象图片（3）与多行视频描述（7）同一行 */}
                  <div className='grid grid-cols-10 gap-3'>
                    <div className='col-span-3 flex flex-col gap-1.5'>
                      <Label>{t('scenes.videoImageLabel')}</Label>
                      <Input
                        type='file'
                        accept='image/*'
                        onChange={(e) => setLpImage(e.target.files?.[0] ?? null)}
                      />
                      {lpImage && (
                        <img
                          src={URL.createObjectURL(lpImage)}
                          alt='source'
                          className='aspect-[9/16] w-full max-w-[120px] rounded-md border object-cover'
                        />
                      )}
                    </div>
                    <div className='col-span-7 flex flex-col gap-1.5'>
                      <Label>{t('scenes.videoDescLabel')}</Label>
                      <Textarea
                        value={lpDesc}
                        onChange={(e) => setLpDesc(e.target.value)}
                        placeholder={t('scenes.videoDescPlaceholder')}
                        rows={4}
                        className='h-full min-h-[110px] resize-y'
                      />
                    </div>
                  </div>

                  {/* LivePortrait 参数：默认隐藏，开关展开 */}
                  <div className='flex flex-wrap items-center gap-2 rounded-md border p-2.5'>
                    <span className='text-sm font-medium'>{t('studio.lpPresets')}</span>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={generating}
                      onClick={() =>
                        setLpSettings({ ...DEFAULT_LIVEPORTRAIT_SETTINGS })
                      }
                    >
                      {t('studio.lpPresetDefault')}
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={generating}
                      onClick={() => setLpSettings({ ...BLINK_IDLE_SETTINGS })}
                    >
                      {t('studio.lpPresetBlinkIdle')}
                    </Button>
                    <p className='w-full text-xs text-muted-foreground'>
                      {t('studio.lpPresetHint')}
                    </p>
                  </div>
                  <div className='flex items-center justify-between rounded-md border p-3'>
                    <div>
                      <p className='text-sm font-medium'>
                        {t('studio.liveportraitTitle')}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        {t('studio.liveportraitDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={showParams}
                      onCheckedChange={setShowParams}
                    />
                  </div>
                  {showParams && (
                    <LivePortraitSettingsPanel
                      value={lpSettings}
                      onChange={setLpSettings}
                      disabled={generating}
                    />
                  )}
                  <div className='flex justify-end gap-2'>
                    <Button variant='outline' onClick={goBack}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      onClick={() => void submitLivePortrait()}
                      disabled={generating}
                    >
                      {generating && (
                        <LoaderCircle className='size-4 animate-spin' />
                      )}
                      {t('scenes.generate')}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value='other' className='mt-4'>
                  <p className='py-6 text-center text-sm text-muted-foreground'>
                    {t('scenes.tabOtherDesc')}
                  </p>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}

export function SceneVideoAddPage() {
  return (
    <PageErrorBoundary>
      <SceneVideoAddPageInner />
    </PageErrorBoundary>
  )
}
