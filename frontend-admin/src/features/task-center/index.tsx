import axios from 'axios'
import { Eye, ListChecks, RefreshCw, RotateCcw, SkipForward, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, type Avatar, type BroadcastTask } from '@/lib/api'
import { TaskProgress } from '@/components/task-progress'
import { ConfirmDialog } from '@/components/confirm-dialog'

function showApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? fallback)
    return
  }
  toast.error(fallback)
}

const AVATAR_STATUS_KEY: Record<Avatar['status'], string> = {
  initializing: 'common.generating',
  ready: 'common.ready',
  failed: 'common.failed',
  skipped: 'common.skipped',
}

const AVATAR_STATUS_VARIANT: Record<
  Avatar['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  initializing: 'default',
  ready: 'secondary',
  failed: 'destructive',
  skipped: 'outline',
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

function formatTime(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(locale, { hour12: false })
}

export function TaskCenter() {
  const { t, i18n } = useTranslation()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [tasks, setTasks] = useState<BroadcastTask[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAvatars, setSelectedAvatars] = useState<Set<number>>(new Set())
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<BroadcastTask | null>(null)
  const locale = i18n.language === 'en' ? 'en-US' : 'zh-CN'

  const load = useCallback(async () => {
    try {
      const [avatarResp, taskResp] = await Promise.all([
        api.get<{ data: Avatar[] }>('/avatars'),
        api.get<{ data: BroadcastTask[] }>('/tasks'),
      ])
      setAvatars(avatarResp.data.data)
      setTasks(taskResp.data.data)
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  // Drop selections whose rows disappeared after a refresh.
  useEffect(() => {
    setSelectedAvatars(
      (prev) => new Set([...prev].filter((id) => avatars.some((a) => a.id === id))),
    )
    setSelectedTasks(
      (prev) => new Set([...prev].filter((id) => tasks.some((t) => t.id === id))),
    )
  }, [avatars, tasks])

  const runAction = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn()
      toast.success(success)
      void load()
    } catch (error) {
      showApiError(error, t('common.requestFailed'))
    }
  }

  const toggleId = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    id: number,
  ) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runBatch = async (
    jobs: { id: number; fn: () => Promise<unknown> }[],
    label: string,
    clear: () => void,
  ) => {
    if (jobs.length === 0) {
      toast.info(t('task.noMatching'))
      return
    }
    const results = await Promise.allSettled(jobs.map((job) => job.fn()))
    const ok = results.filter((r) => r.status === 'fulfilled').length
    toast.success(t('task.batchDone', { label, ok, total: jobs.length }))
    clear()
    void load()
  }

  const avatarJobs = (
    predicate: (a: Avatar) => boolean,
    fn: (id: number) => Promise<unknown>,
  ) =>
    avatars
      .filter((a) => selectedAvatars.has(a.id) && predicate(a))
      .map((a) => ({ id: a.id, fn: () => fn(a.id) }))

  const taskJobs = (
    predicate: (t: BroadcastTask) => boolean,
    fn: (id: number) => Promise<unknown>,
  ) =>
    tasks
      .filter((t) => selectedTasks.has(t.id) && predicate(t))
      .map((t) => ({ id: t.id, fn: () => fn(t.id) }))

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <ListChecks className='size-6' />
              {t('task.title')}
            </h2>
            <p className='text-muted-foreground'>{t('task.subtitle')}</p>
          </div>
          <Button variant='outline' size='sm' onClick={() => void load()}>
            <RefreshCw className='size-4' />
            {t('common.refresh')}
          </Button>
        </div>

        <Tabs defaultValue='avatars'>
          <TabsList>
            <TabsTrigger value='avatars'>{t('task.tabAvatars')}</TabsTrigger>
            <TabsTrigger value='tasks'>{t('task.tabTasks')}</TabsTrigger>
          </TabsList>

          <TabsContent value='avatars'>
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle>{t('task.avatarCardTitle')}</CardTitle>
                <CardDescription>{t('task.avatarCardDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className='py-8 text-center text-sm text-muted-foreground'>
                    {t('common.loading')}
                  </p>
                ) : (
                  <>
                    {selectedAvatars.size > 0 && (
                      <div className='mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm'>
                        <span className='me-1 font-medium'>
                          {t('task.selectedAvatars', { count: selectedAvatars.size })}
                        </span>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            void runBatch(
                              avatarJobs(
                                (a) => a.status === 'initializing',
                                (id) => api.post(`/avatars/${id}/skip`),
                              ),
                              t('task.batchSkip'),
                              () => setSelectedAvatars(new Set()),
                            )
                          }
                        >
                          {t('task.batchSkip')}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            void runBatch(
                              avatarJobs(
                                (a) => a.status !== 'initializing',
                                (id) => api.post(`/avatars/${id}/retry`),
                              ),
                              t('task.batchRetryRegen'),
                              () => setSelectedAvatars(new Set()),
                            )
                          }
                        >
                          {t('task.batchRetryRegen')}
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          onClick={() => {
                            if (
                              window.confirm(
                                t('task.confirmDeleteAvatars', {
                                  count: selectedAvatars.size,
                                }),
                              )
                            ) {
                              void runBatch(
                                avatarJobs(() => true, (id) => api.delete(`/avatars/${id}`)),
                                t('task.batchDelete'),
                                () => setSelectedAvatars(new Set()),
                              )
                            }
                          }}
                        >
                          {t('task.batchDelete')}
                        </Button>
                      </div>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-10'>
                            <Checkbox
                              checked={
                                avatars.length > 0 &&
                                avatars.every((a) => selectedAvatars.has(a.id))
                              }
                              onCheckedChange={(checked) =>
                                setSelectedAvatars(
                                  checked
                                    ? new Set(avatars.map((a) => a.id))
                                    : new Set(),
                                )
                              }
                            />
                          </TableHead>
                          <TableHead>{t('task.colAvatar')}</TableHead>
                          <TableHead>{t('task.colVoice')}</TableHead>
                          <TableHead>{t('common.status')}</TableHead>
                          <TableHead>{t('common.createdAt')}</TableHead>
                          <TableHead className='text-right'>{t('common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {avatars.map((avatar) => {
                          const statusLabel = t(AVATAR_STATUS_KEY[avatar.status])
                          return (
                            <TableRow key={avatar.id}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedAvatars.has(avatar.id)}
                                  onCheckedChange={() =>
                                    toggleId(setSelectedAvatars, avatar.id)
                                  }
                                />
                              </TableCell>
                              <TableCell>
                              <div className='flex items-center gap-3'>
                                {avatar.imageS3Url && (
                                  <img
                                    src={avatar.imageS3Url}
                                    alt={avatar.name}
                                    className='h-10 w-10 rounded-md border object-cover'
                                  />
                                )}
                                <div className='min-w-0'>
                                  <p className='truncate font-medium'>{avatar.name}</p>
                                  <p className='text-xs text-muted-foreground'>#{avatar.id}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className='max-w-[180px] truncate'>
                              {avatar.voiceId}
                            </TableCell>
                            <TableCell>
                              <Badge variant={AVATAR_STATUS_VARIANT[avatar.status]}>
                                {statusLabel}
                                {avatar.initQueuePos !== undefined &&
                                avatar.status === 'initializing'
                                  ? ` · ${t('task.queuePos', { pos: avatar.initQueuePos + 1 })}`
                                  : ''}
                              </Badge>
                            </TableCell>
                            <TableCell className='whitespace-nowrap text-sm text-muted-foreground'>
                              {formatTime(avatar.createdAt, locale)}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex justify-end gap-1'>
                                <Button asChild variant='ghost' size='sm'>
                                  <Link
                                    to='/avatar-library'
                                    search={{ avatarId: String(avatar.id) }}
                                  >
                                    <Eye className='size-3.5' />
                                    {t('task.view')}
                                  </Link>
                                </Button>
                                {avatar.status === 'initializing' && (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() =>
                                      void runAction(
                                        () => api.post(`/avatars/${avatar.id}/skip`),
                                        t('task.toastSkipped', { name: avatar.name }),
                                      )
                                    }
                                  >
                                    <SkipForward className='size-3.5' />
                                    {t('task.skip')}
                                  </Button>
                                )}
                                {(avatar.status === 'failed' ||
                                  avatar.status === 'skipped' ||
                                  avatar.status === 'ready') && (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() =>
                                      void runAction(
                                        () => api.post(`/avatars/${avatar.id}/retry`),
                                        avatar.status === 'ready'
                                          ? t('task.toastRegenerating', { name: avatar.name })
                                          : t('task.toastRequeued', { name: avatar.name }),
                                      )
                                    }
                                  >
                                    <RotateCcw className='size-3.5' />
                                    {avatar.status === 'ready'
                                      ? t('task.regenerate')
                                      : t('task.retry')}
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='text-destructive'
                                  onClick={() => {
                                    if (window.confirm(t('task.confirmDeleteAvatar', { name: avatar.name }))) {
                                      void runAction(
                                        () => api.delete(`/avatars/${avatar.id}`),
                                        t('task.toastDeleted', { name: avatar.name }),
                                      )
                                    }
                                  }}
                                >
                                  <Trash2 className='size-3.5' />
                                  {t('task.delete')}
                                </Button>
                              </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='tasks'>
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle>{t('task.taskCardTitle')}</CardTitle>
                <CardDescription>{t('task.taskCardDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className='py-8 text-center text-sm text-muted-foreground'>
                    {t('common.loading')}
                  </p>
                ) : (
                  <>
                    {selectedTasks.size > 0 && (
                      <div className='mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm'>
                        <span className='me-1 font-medium'>
                          {t('task.selectedTasks', { count: selectedTasks.size })}
                        </span>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            void runBatch(
                              taskJobs(
                                (t) => t.status === 'failed',
                                (id) => api.post(`/tasks/${id}/retry`),
                              ),
                              t('task.batchRetry'),
                              () => setSelectedTasks(new Set()),
                            )
                          }
                        >
                          {t('task.batchRetry')}
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          onClick={() => {
                            if (
                              window.confirm(
                                t('task.confirmDeleteTasks', {
                                  count: selectedTasks.size,
                                }),
                              )
                            ) {
                              void runBatch(
                                taskJobs(() => true, (id) => api.delete(`/tasks/${id}`)),
                                t('task.batchDelete'),
                                () => setSelectedTasks(new Set()),
                              )
                            }
                          }}
                        >
                          {t('task.batchDelete')}
                        </Button>
                      </div>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-10'>
                            <Checkbox
                              checked={
                                tasks.length > 0 && tasks.every((t) => selectedTasks.has(t.id))
                              }
                              onCheckedChange={(checked) =>
                                setSelectedTasks(
                                  checked ? new Set(tasks.map((t) => t.id)) : new Set(),
                                )
                              }
                            />
                          </TableHead>
                          <TableHead>ID</TableHead>
                          <TableHead>{t('task.colAvatar')}</TableHead>
                          <TableHead>{t('task.colScript')}</TableHead>
                          <TableHead>{t('common.status')}</TableHead>
                          <TableHead>{t('common.createdAt')}</TableHead>
                          <TableHead className='text-right'>{t('common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tasks.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className='py-8 text-center text-sm text-muted-foreground'
                            >
                              {t('task.emptyTasks')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          tasks.map((task) => {
                            const statusLabel = t(TASK_STATUS_KEY[task.status])
                            return (
                              <TableRow key={task.id}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedTasks.has(task.id)}
                                  onCheckedChange={() => toggleId(setSelectedTasks, task.id)}
                                />
                              </TableCell>
                              <TableCell>#{task.id}</TableCell>
                            <TableCell>{task.avatarName ?? `#${task.avatarId}`}</TableCell>
                            <TableCell className='max-w-[260px] truncate' title={task.scriptText}>
                              {task.scriptText}
                            </TableCell>
                            <TableCell>
                              {task.status === 'processing' &&
                              task.progress !== undefined ? (
                                <TaskProgress
                                  value={task.progress}
                                  label={t(TASK_STAGE_KEY[task.stage ?? 'tts'])}
                                />
                              ) : (
                                <Badge variant={TASK_STATUS_VARIANT[task.status]}>
                                  {statusLabel}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className='whitespace-nowrap text-sm text-muted-foreground'>
                              {formatTime(task.createdAt, locale)}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex justify-end gap-1'>
                                <Button asChild variant='ghost' size='sm'>
                                  <Link
                                    to='/broadcast'
                                    search={{
                                      avatarId: String(task.avatarId),
                                      taskId: String(task.id),
                                    }}
                                  >
                                    <Eye className='size-3.5' />
                                    {t('task.view')}
                                  </Link>
                                </Button>
                                {(task.status === 'failed' || task.status === 'processing') && (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() =>
                                      void runAction(
                                        () => api.post(`/tasks/${task.id}/retry`),
                                        t('task.toastTaskRequeued', { id: task.id }),
                                      )
                                    }
                                  >
                                    <RotateCcw className='size-3.5' />
                                    {t('task.retry')}
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='text-destructive'
                                  onClick={() => setDeleteTaskTarget(task)}
                                >
                                  <Trash2 className='size-3.5' />
                                  {t('task.delete')}
                                </Button>
                              </div>
                              </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
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
          handleConfirm={() => {
            const target = deleteTaskTarget
            setDeleteTaskTarget(null)
            if (target) {
              void runAction(
                () => api.delete(`/tasks/${target.id}`),
                t('task.toastTaskDeleted', { id: target.id }),
              )
            }
          }}
        />
      </Main>
    </>
  )
}
