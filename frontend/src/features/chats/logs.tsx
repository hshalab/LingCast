import {
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  MessagesSquare,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  api,
  fetchChatLogs,
  type Avatar,
  type ChatLogItem,
} from '@/lib/api'

function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/**
 * Chat log page: browse persisted room messages (filter by avatar / user /
 * date / keyword) and inspect whether a bot reply hit the knowledge base and
 * which exact chunks were retrieved.
 */
export function ChatLogs() {
  const { t } = useTranslation()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [items, setItems] = useState<ChatLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [avatarFilter, setAvatarFilter] = useState('')
  const [userId, setUserId] = useState('')
  const [date, setDate] = useState('')
  const [keyword, setKeyword] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const loadAvatars = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Avatar[] }>('/avatars')
      setAvatars(data.data)
    } catch {
      // keep previous data
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(
        await fetchChatLogs({
          avatarId: avatarFilter ? Number(avatarFilter) : undefined,
          userId: userId ? Number(userId) : undefined,
          date: date || undefined,
          q: keyword.trim() || undefined,
        }),
      )
    } catch {
      toast.error(t('chatLogs.toastFailed'))
    } finally {
      setLoading(false)
    }
  }, [avatarFilter, userId, date, keyword, t])

  useEffect(() => {
    void loadAvatars()
  }, [loadAvatars])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
              <MessagesSquare className='size-6' />
              {t('chatLogs.title')}
            </h2>
            <p className='text-muted-foreground'>{t('chatLogs.subtitle')}</p>
          </div>
          <Button variant='outline' size='sm' onClick={() => void load()}>
            <RefreshCw className='size-4' />
            {t('common.refresh')}
          </Button>
        </div>

        {/* Filters */}
        <div className='flex flex-wrap items-center gap-2'>
          <Select value={avatarFilter} onValueChange={setAvatarFilter}>
            <SelectTrigger className='w-48'>
              <SelectValue placeholder={t('chatLogs.filterAllAvatars')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=''>{t('chatLogs.filterAllAvatars')}</SelectItem>
              {avatars.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name} (#{a.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type='number'
            min={1}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t('chatLogs.filterUserId')}
            className='w-36'
          />
          <Input
            type='date'
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className='w-44'
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('chatLogs.filterKeyword')}
            className='w-56'
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
          <Button size='sm' onClick={() => void load()}>
            <Search className='size-4' />
            {t('common.search')}
          </Button>
        </div>

        {/* Logs */}
        <Card>
          <CardHeader className='gap-1'>
            <CardTitle>{t('chatLogs.listTitle')}</CardTitle>
            <CardDescription>{t('chatLogs.listDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                {t('common.loading')}
              </p>
            ) : items.length === 0 ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                {t('chatLogs.empty')}
              </p>
            ) : (
              <div className='flex flex-col gap-2'>
                {items.map((m) => {
                  const isBot = m.role === 'bot'
                  const open = expanded.has(m.id)
                  return (
                    <div
                      key={m.id}
                      className={`rounded-lg border p-3 ${
                        isBot ? 'bg-muted/30' : ''
                      }`}
                    >
                      <div className='mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                        <Badge variant='default'>
                          {m.avatarName ?? `#${m.avatarId}`}
                        </Badge>
                        <Badge variant={isBot ? 'secondary' : 'outline'}>
                          {isBot ? t('chatLogs.bot') : t('chatLogs.user')}
                        </Badge>
                        <span className='font-medium text-foreground'>
                          {m.username}
                        </span>
                        <span>#{m.userId}</span>
                        <span>{formatTime(m.createdAt)}</span>
                        {isBot && m.ragHit && (
                          <Badge className='border-0 bg-emerald-600 text-white'>
                            <BookOpenCheck className='me-1 size-3' />
                            {t('chatLogs.ragHit')}
                          </Badge>
                        )}
                      </div>
                      <p className='whitespace-pre-wrap text-sm text-foreground'>
                        {m.content}
                      </p>
                      {isBot && m.ragHit && m.ragSources && m.ragSources.length > 0 && (
                        <div className='mt-2'>
                          <button
                            onClick={() => toggle(m.id)}
                            className='flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground'
                          >
                            {open ? (
                              <ChevronDown className='size-3.5' />
                            ) : (
                              <ChevronRight className='size-3.5' />
                            )}
                            {t('chatLogs.ragSources')} ({m.ragSources.length})
                          </button>
                          {open && (
                            <ol className='mt-1 list-decimal space-y-1 ps-5 text-xs text-muted-foreground'>
                              {m.ragSources.map((s, i) => (
                                <li key={i} className='break-words'>
                                  {s}
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
