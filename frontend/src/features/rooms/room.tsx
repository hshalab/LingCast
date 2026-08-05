import axios from 'axios'
import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import FlvPlugin from 'xgplayer-flv'
import { LoaderCircle, Send, Tv } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { api, type LiveMessageResponse } from '@/lib/api'

type ChatMessage = { role: 'user' | 'bot'; text: string }

export function Room({ avatarId }: { avatarId: string }) {
  const id = Number(avatarId)
  const playerHostRef = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const streamUrl = `${window.location.origin}/live/avatar_${id}.flv`

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
    return () => {
      player.destroy()
    }
  }, [id, started, streamUrl])

  useEffect(() => {
    if (!id) return
    let stopped = false
    const poll = async () => {
      try {
        await api.get(`/live/${id}/status`)
        if (!stopped) {
          setStarted(true)
        }
      } catch (error) {
        const notFound = axios.isAxiosError(error) && error.response?.status === 404
        if (!stopped && notFound) {
          setStarted(false)
        }
      }
    }
    void poll()
    const timer = window.setInterval(poll, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [id])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setMessages((prev) => [...prev, { role: 'user', text }])
    try {
      const { data } = await api.post<LiveMessageResponse>(`/live/${id}/message`, { text })
      setInput('')
      if (data.reply) {
        setMessages((prev) => [...prev, { role: 'bot', text: data.reply }])
      }
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : '发送失败'
      toast.error(msg ?? '发送失败')
    } finally {
      setSending(false)
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
        <div className='flex items-center gap-2'>
          <h2 className='text-2xl font-bold tracking-tight'>
            <Tv className='me-2 inline size-6' />
            直播间 #{id}
          </h2>
          <Badge variant={started ? 'default' : 'outline'}>
            {started ? '直播中' : '未开播'}
          </Badge>
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <Card className='lg:col-span-2'>
            <CardHeader className='gap-1'>
              <CardTitle>直播画面</CardTitle>
              <CardDescription>
                拉流地址：<code className='break-all text-xs'>{streamUrl}</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='flex justify-center'>
                {started ? (
                  <div
                    ref={playerHostRef}
                    className='aspect-[9/16] w-full max-w-[720px] rounded-lg border bg-black'
                  />
                ) : (
                  <div className='flex aspect-[9/16] w-full max-w-[720px] flex-col items-center justify-center gap-2 rounded-lg border bg-muted text-sm text-muted-foreground'>
                    <Tv className='size-8' />
                    主播暂未开播
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='gap-1'>
              <CardTitle>互动聊天</CardTitle>
              <CardDescription>发送消息，数字人会通过 AI 回复并开口说话。</CardDescription>
            </CardHeader>
            <CardContent className='flex h-[calc(720px*16/9*0.45)] min-h-[320px] flex-col'>
              <div className='flex-1 space-y-2 overflow-y-auto pr-1'>
                {messages.length === 0 ? (
                  <p className='py-8 text-center text-sm text-muted-foreground'>
                    还没有消息，说点什么吧
                  </p>
                ) : (
                  messages.map((m, i) => (
                    <div
                      key={i}
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        m.role === 'user'
                          ? 'ms-auto bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {m.text}
                    </div>
                  ))
                )}
              </div>
              <div className='mt-3 flex gap-2'>
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void send()}
                  placeholder='发条消息…'
                  disabled={!started}
                />
                <Button onClick={() => void send()} disabled={sending || !input.trim() || !started}>
                  {sending ? <LoaderCircle className='size-4 animate-spin' /> : <Send className='size-4' />}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}
