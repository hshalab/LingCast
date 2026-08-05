import axios from 'axios'
import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import FlvPlugin from 'xgplayer-flv'
import { Copy, LoaderCircle, Power, PowerOff, Send, Video } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { api, type Avatar, type LiveSessionItem, type LiveStatus } from '@/lib/api'

function showApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: string } | undefined)?.error
    toast.error(message ?? '请求失败，请稍后重试')
    return
  }
  toast.error('请求失败，请稍后重试')
}

export function LiveStudio({ avatarId }: { avatarId: string }) {
  const id = Number(avatarId)
  const playerHostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [liveSessions, setLiveSessions] = useState<LiveSessionItem[]>([])
  // Full pull URL: dev uses VITE_API_BASE_URL, dockerized app falls back to
  // the current origin (e.g. http://localhost:8080).
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const streamUrl = `${import.meta.env.VITE_API_BASE_URL || origin}/live/avatar_${id}.flv`

  // Check whether the live session already exists on load.
  useEffect(() => {
    if (!id) return
    api
      .get(`/live/${id}/status`)
      .then(() => setStarted(true))
      .catch(() => setStarted(false))
  }, [id])

  // Avatar switcher data: ready avatars + which ones are live, every 3s.
  useEffect(() => {
    if (!id) return
    let stopped = false
    const refresh = async () => {
      try {
        const [avatarResp, liveResp] = await Promise.all([
          api.get<{ data: Avatar[] }>('/avatars'),
          api.get<{ data: LiveSessionItem[] }>('/live'),
        ])
        if (stopped) return
        setAvatars(avatarResp.data.data)
        setLiveSessions(liveResp.data.data)
      } catch {
        // keep previous data
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [id])

  // HTTP-FLV player (xgplayer + flv plugin) — only while the stream is on.
  useEffect(() => {
    if (!id || !started || !playerHostRef.current) return
    const player = new Player({
      el: playerHostRef.current,
      url: streamUrl,
      type: 'flv',
      isLive: true,
      autoplay: true,
      width: '100%',
      height: '100%',
      plugins: [FlvPlugin],
    })
    playerRef.current = player
    return () => {
      player.destroy()
      playerRef.current = null
    }
  }, [id, started, streamUrl])

  // Queue monitor: refresh every second.
  useEffect(() => {
    if (!id) return
    let stopped = false
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get<LiveStatus>(`/live/${id}/status`)
        if (!stopped) {
          setStatus(data)
          setStarted(true)
        }
      } catch (error) {
        // Only a 404 means the session is gone; other errors keep polling.
        const notFound = axios.isAxiosError(error) && error.response?.status === 404
        if (!stopped && notFound) {
          setStatus(null)
          setStarted(false)
        }
      }
    }, 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [id])

  const handleStart = async () => {
    if (!id || busy) return
    setBusy(true)
    try {
      await api.post(`/live/${id}/start`)
      setStarted(true)
      toast.success('直播已开启，画面即将就绪')
    } catch (error) {
      showApiError(error)
    } finally {
      setBusy(false)
    }
  }

  const handleStop = async () => {
    if (!id || busy) return
    setBusy(true)
    try {
      await api.post(`/live/${id}/stop`)
      setStarted(false)
      setStatus(null)
      toast.success('直播已关闭')
    } catch (error) {
      showApiError(error)
    } finally {
      setBusy(false)
    }
  }

  const copyStreamUrl = async () => {
    try {
      await navigator.clipboard.writeText(streamUrl)
      toast.success('拉流地址已复制')
    } catch {
      toast.error('复制失败，请手动选择复制')
    }
  }

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await api.post(`/live/${id}/push`, { text: trimmed })
      setText('')
    } catch (error) {
      showApiError(error)
    } finally {
      setSending(false)
    }
  }, [id, text, sending])

  const statusVariant =
    status?.status === 'active'
      ? 'default'
      : status?.status === 'pending'
        ? 'secondary'
        : 'outline'

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
            <h2 className='text-2xl font-bold tracking-tight'>Live Studio</h2>
            <p className='text-muted-foreground'>
              Avatar #{id} 实时直播：输入文字后数字人将开口播报。
            </p>
          </div>
          <div className='flex items-center gap-2'>
            {status && (
              <Badge variant={statusVariant}>
                {status.status === 'active'
                  ? '说话中'
                  : status.status === 'pending'
                    ? '启动中'
                    : '闲置'}
              </Badge>
            )}
            {started ? (
              <Button variant='destructive' size='sm' onClick={() => void handleStop()} disabled={busy}>
                {busy ? <LoaderCircle className='size-4 animate-spin' /> : <PowerOff className='size-4' />}
                关闭直播
              </Button>
            ) : (
              <Button size='sm' onClick={() => void handleStart()} disabled={busy}>
                {busy ? <LoaderCircle className='size-4 animate-spin' /> : <Power className='size-4' />}
                打开直播
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className='flex flex-wrap items-center gap-2 py-3 text-sm'>
            <span className='text-muted-foreground'>拉流地址：</span>
            <code className='break-all rounded bg-muted px-2 py-1'>{streamUrl}</code>
            <Button variant='ghost' size='sm' onClick={() => void copyStreamUrl()}>
              <Copy className='size-3.5' />
              复制
            </Button>
            <span className='text-xs text-muted-foreground'>
              多个页面同时打开看到同一路直播；任一页面关闭直播即停止全部；所有页面共用同一文字队列。
            </span>
          </CardContent>
        </Card>

        <div className='grid gap-4 lg:grid-cols-4'>
          {/* Left: avatar switcher */}
          <Card className='lg:col-span-1'>
            <CardHeader className='gap-1'>
              <CardTitle>数字人直播</CardTitle>
              <CardDescription>多个数字人可同时直播，分别发送文字。</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-2'>
              {avatars
                .filter((avatar) => Boolean(avatar.baseVideoS3Key))
                .map((avatar) => {
                  const live = liveSessions.some((s) => s.avatarId === avatar.id)
                  const active = avatar.id === id
                  return (
                    <Link
                      key={avatar.id}
                      to='/live-studio'
                      search={{ avatarId: String(avatar.id) }}
                      className={`flex items-center gap-3 rounded-lg border p-2 transition-colors hover:bg-muted ${
                        active ? 'border-primary bg-muted ring-1 ring-primary' : ''
                      }`}
                    >
                      {avatar.imageS3Url && (
                        <img
                          src={avatar.imageS3Url}
                          alt={avatar.name}
                          className='h-9 w-9 rounded-md border object-cover'
                        />
                      )}
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>{avatar.name}</p>
                        <p className='text-xs text-muted-foreground'>#{avatar.id}</p>
                      </div>
                      <Badge variant={live ? 'default' : 'outline'}>
                        {live ? '直播中' : '未开启'}
                      </Badge>
                    </Link>
                  )
                })}
            </CardContent>
          </Card>

          {/* Player */}
          <Card className='lg:col-span-2'>
            <CardHeader className='flex-row items-center justify-between space-y-0'>
              <CardTitle>直播画面</CardTitle>
              <Badge variant='outline'>
                <Video className='me-1 size-3.5' />
                HTTP-FLV
              </Badge>
            </CardHeader>
            <CardContent>
              <div className='flex justify-center'>
                <div
                  ref={playerHostRef}
                  className='aspect-[9/16] w-full max-w-[720px] rounded-lg border bg-black'
                />
              </div>
            </CardContent>
          </Card>

          {/* Right: queue + input */}
          <div className='flex flex-col gap-4'>
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle>待渲染队列</CardTitle>
                <CardDescription>
                  {status ? `当前队列 ${status.queueLength} 条` : '读取中…'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {status && status.pending.length === 0 ? (
                  <p className='py-4 text-center text-sm text-muted-foreground'>
                    队列为空，数字人处于闲置状态
                  </p>
                ) : (
                  <ol className='max-h-56 list-decimal space-y-1 overflow-y-auto ps-5 text-sm'>
                    {status?.pending.map((item, i) => (
                      <li key={`${i}-${item}`} className='line-clamp-2 text-muted-foreground'>
                        {item}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='gap-1'>
                <CardTitle>发送文字</CardTitle>
                <CardDescription>按句子切块后进入队列，数字人将依次播报。</CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                {status && status.history.length > 0 && (
                  <div className='flex flex-col gap-1'>
                    <p className='text-xs text-muted-foreground'>已发送文字：</p>
                    <ol className='max-h-32 list-decimal space-y-1 overflow-y-auto border rounded-md bg-muted/40 p-2 ps-6 text-xs text-muted-foreground'>
                      {status.history.map((item, i) => (
                        <li key={`${i}-${item}`} className='break-all'>
                          {item}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <Textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder='例如：大家好！欢迎来到直播间。今天聊聊数字人。'
                  rows={4}
                />
                <Button onClick={() => void handleSend()} disabled={sending || !text.trim()}>
                  {sending ? <LoaderCircle className='size-4 animate-spin' /> : <Send className='size-4' />}
                  发送
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
