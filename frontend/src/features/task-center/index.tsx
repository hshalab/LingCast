import axios from 'axios'
import { ListChecks, RefreshCw, RotateCcw, SkipForward, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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

function showApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? '请求失败，请稍后重试')
    return
  }
  toast.error('请求失败，请稍后重试')
}

const AVATAR_STATUS_META: Record<
  Avatar['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  initializing: { label: '生成中', variant: 'default' },
  ready: { label: '就绪', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  skipped: { label: '已跳过', variant: 'outline' },
}

const TASK_STATUS_META: Record<
  BroadcastTask['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending: { label: '排队中', variant: 'secondary' },
  processing: { label: '合成中', variant: 'default' },
  completed: { label: '已完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

export function TaskCenter() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [tasks, setTasks] = useState<BroadcastTask[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [avatarResp, taskResp] = await Promise.all([
        api.get<{ data: Avatar[] }>('/avatars'),
        api.get<{ data: BroadcastTask[] }>('/tasks'),
      ])
      setAvatars(avatarResp.data.data)
      setTasks(taskResp.data.data)
    } catch (error) {
      showApiError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  const runAction = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn()
      toast.success(success)
      void load()
    } catch (error) {
      showApiError(error)
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
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <ListChecks className='size-6' />
              任务中心
            </h2>
            <p className='text-muted-foreground'>
              查看头像基础视频生成与播报任务的进度，可重试、跳过或删除。
            </p>
          </div>
          <Button variant='outline' size='sm' onClick={() => void load()}>
            <RefreshCw className='size-4' />
            刷新
          </Button>
        </div>

        <Tabs defaultValue='avatars'>
          <TabsList>
            <TabsTrigger value='avatars'>头像初始化</TabsTrigger>
            <TabsTrigger value='tasks'>播报任务</TabsTrigger>
          </TabsList>

          <TabsContent value='avatars'>
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle>头像基础视频</CardTitle>
                <CardDescription>
                  LivePortrait 预处理任务（avatar_init 队列），约 1-3 分钟/个。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className='py-8 text-center text-sm text-muted-foreground'>加载中…</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>头像</TableHead>
                        <TableHead>音色</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {avatars.map((avatar) => {
                        const meta = AVATAR_STATUS_META[avatar.status]
                        return (
                          <TableRow key={avatar.id}>
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
                              <Badge variant={meta.variant}>
                                {meta.label}
                                {avatar.initQueuePos !== undefined &&
                                avatar.status === 'initializing'
                                  ? ` · 排队第 ${avatar.initQueuePos + 1}`
                                  : ''}
                              </Badge>
                            </TableCell>
                            <TableCell className='whitespace-nowrap text-sm text-muted-foreground'>
                              {formatTime(avatar.createdAt)}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex justify-end gap-1'>
                                {avatar.status === 'initializing' && (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() =>
                                      void runAction(
                                        () => api.post(`/avatars/${avatar.id}/skip`),
                                        `已跳过「${avatar.name}」`,
                                      )
                                    }
                                  >
                                    <SkipForward className='size-3.5' />
                                    跳过
                                  </Button>
                                )}
                                {(avatar.status === 'failed' || avatar.status === 'skipped') && (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() =>
                                      void runAction(
                                        () => api.post(`/avatars/${avatar.id}/retry`),
                                        `已重新排队「${avatar.name}」`,
                                      )
                                    }
                                  >
                                    <RotateCcw className='size-3.5' />
                                    重试
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='text-destructive'
                                  onClick={() => {
                                    if (window.confirm(`确定删除头像「${avatar.name}」？`)) {
                                      void runAction(
                                        () => api.delete(`/avatars/${avatar.id}`),
                                        `已删除「${avatar.name}」`,
                                      )
                                    }
                                  }}
                                >
                                  <Trash2 className='size-3.5' />
                                  删除
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
          </TabsContent>

          <TabsContent value='tasks'>
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle>播报任务</CardTitle>
                <CardDescription>Edge-TTS + Wav2Lip 离线合成任务。</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className='py-8 text-center text-sm text-muted-foreground'>加载中…</p>
                ) : tasks.length === 0 ? (
                  <p className='py-8 text-center text-sm text-muted-foreground'>暂无播报任务</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>头像</TableHead>
                        <TableHead>脚本</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tasks.map((task) => {
                        const meta = TASK_STATUS_META[task.status]
                        return (
                          <TableRow key={task.id}>
                            <TableCell>#{task.id}</TableCell>
                            <TableCell>{task.avatarName ?? `#${task.avatarId}`}</TableCell>
                            <TableCell className='max-w-[260px] truncate' title={task.scriptText}>
                              {task.scriptText}
                            </TableCell>
                            <TableCell>
                              <Badge variant={meta.variant}>{meta.label}</Badge>
                            </TableCell>
                            <TableCell className='whitespace-nowrap text-sm text-muted-foreground'>
                              {formatTime(task.createdAt)}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex justify-end gap-1'>
                                {task.status === 'failed' && (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() =>
                                      void runAction(
                                        () => api.post(`/tasks/${task.id}/retry`),
                                        `任务 #${task.id} 已重新入队`,
                                      )
                                    }
                                  >
                                    <RotateCcw className='size-3.5' />
                                    重试
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='text-destructive'
                                  onClick={() => {
                                    if (window.confirm(`确定删除任务 #${task.id}？`)) {
                                      void runAction(
                                        () => api.delete(`/tasks/${task.id}`),
                                        `任务 #${task.id} 已删除`,
                                      )
                                    }
                                  }}
                                >
                                  <Trash2 className='size-3.5' />
                                  删除
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
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
