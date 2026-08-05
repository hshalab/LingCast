import axios from 'axios'
import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import FlvPlugin from 'xgplayer-flv'
import { LoaderCircle, Send, Video } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { api, type LiveStatus } from '@/lib/api'

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
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  // Start the live session (worker opens the continuous FFmpeg pipe).
  useEffect(() => {
    if (!id) return
    api
      .post(`/live/${id}/start`)
      .then(() => toast.success('直播会话已启动，画面即将就绪'))
      .catch(showApiError)
  }, [id])

  // HTTP-FLV player (SRS via nginx /live proxy).
  useEffect(() => {
    if (!id || !playerHostRef.current) return
    const base = `${import.meta.env.VITE_API_BASE_URL ?? ''}`
    const url = `${base}/live/avatar_${id}.flv`
    const player = new Player({
      el: playerHostRef.current,
      url,
      type: 'flv',
      isLive: true,
      autoplay: true,
      fluid: true,
      plugins: [FlvPlugin],
    })
    playerRef.current = player
    return () => {
      player.destroy()
      playerRef.current = null
    }
  }, [id])

  // Queue monitor: refresh every second.
  useEffect(() => {
    if (!id) return
    let stopped = false
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get<LiveStatus>(`/live/${id}/status`)
        if (!stopped) setStatus(data)
      } catch {
        // session not started yet or API hiccup; keep polling
      }
    }, 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [id])

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
          {status && (
            <Badge variant={statusVariant}>
              {status.status === 'active'
                ? '说话中'
                : status.status === 'pending'
                  ? '启动中'
                  : '闲置'}
            </Badge>
          )}
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          {/* Left: player */}
          <Card className='lg:col-span-2'>
            <CardHeader className='flex-row items-center justify-between space-y-0'>
              <CardTitle>直播画面</CardTitle>
              <Badge variant='outline'>
                <Video className='me-1 size-3.5' />
                HTTP-FLV
              </Badge>
            </CardHeader>
            <CardContent>
              <div ref={playerHostRef} className='aspect-video w-full rounded-lg border bg-black' />
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
