import { LoaderCircle, RefreshCw, Search, Sparkles } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  api,
  listAllKnowledge,
  searchKnowledge,
  type Avatar,
  type KnowledgeItem,
  type KnowledgeSearchResult,
} from '@/lib/api'

function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/**
 * Knowledge list page: browse all ingested knowledge (filter by avatar /
 * filename / keyword) and run live retrieval tests against the local RAG.
 */
export function KnowledgeList() {
  const { t } = useTranslation()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [avatarFilter, setAvatarFilter] = useState('all')
  const [keyword, setKeyword] = useState('')

  // Retrieval test state
  const [testAvatar, setTestAvatar] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeSearchResult[]>([])
  const [searching, setSearching] = useState(false)

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
        await listAllKnowledge({
          avatarId:
            avatarFilter && avatarFilter !== 'all'
              ? Number(avatarFilter)
              : undefined,
          q: keyword.trim() || undefined,
        }),
      )
    } catch {
      toast.error(t('knowledge.toastListFailed'))
    } finally {
      setLoading(false)
    }
  }, [avatarFilter, keyword, t])

  useEffect(() => {
    void loadAvatars()
  }, [loadAvatars])

  useEffect(() => {
    void load()
  }, [load])

  const runSearch = async () => {
    const aid = Number(testAvatar)
    if (!aid || !query.trim() || searching) return
    setSearching(true)
    try {
      setResults(await searchKnowledge(aid, query.trim(), 3))
    } catch {
      toast.error(t('knowledge.toastSearchFailed'))
    } finally {
      setSearching(false)
    }
  }

  const statusVariant = (s: KnowledgeItem['status']) =>
    s === 'indexed' ? 'secondary' : s === 'failed' ? 'destructive' : 'outline'

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
              {t('knowledge.listTitle')}
            </h2>
            <p className='text-muted-foreground'>{t('knowledge.listSubtitle')}</p>
          </div>
          <Button variant='outline' size='sm' onClick={() => void load()}>
            <RefreshCw className='size-4' />
            {t('common.refresh')}
          </Button>
        </div>

        {/* Filters */}
        <div className='flex flex-wrap items-center gap-2'>
          <Select value={avatarFilter} onValueChange={setAvatarFilter}>
            <SelectTrigger className='w-52'>
              <SelectValue placeholder={t('knowledge.filterAllAvatars')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('knowledge.filterAllAvatars')}</SelectItem>
              {avatars.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name} (#{a.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('knowledge.filterKeyword')}
            className='w-64'
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
          <Button size='sm' onClick={() => void load()}>
            <Search className='size-4' />
            {t('common.search')}
          </Button>
        </div>

        {/* List */}
        <Card>
          <CardHeader className='gap-1'>
            <CardTitle>{t('knowledge.ingestedTitle')}</CardTitle>
            <CardDescription>{t('knowledge.ingestedDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                {t('common.loading')}
              </p>
            ) : items.length === 0 ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                {t('knowledge.empty')}
              </p>
            ) : (
              <div className='flex flex-col gap-2'>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className='flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='mb-1 flex flex-wrap items-center gap-2'>
                        <Badge variant='default'>{item.avatarName ?? `#${item.avatarId}`}</Badge>
                        <Badge variant={statusVariant(item.status)}>
                          {t(`knowledge.status.${item.status}`)}
                        </Badge>
                        {item.filename && (
                          <span className='truncate text-xs text-muted-foreground'>
                            {item.filename}
                          </span>
                        )}
                        <span className='text-xs text-muted-foreground'>
                          {formatTime(item.createdAt)}
                        </span>
                      </div>
                      <p className='line-clamp-2 whitespace-pre-wrap text-sm text-foreground'>
                        {item.content || t('knowledge.pendingContent')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Retrieval test */}
        <Card>
          <CardHeader className='gap-1'>
            <CardTitle className='flex items-center gap-2'>
              <Sparkles className='size-5' />
              {t('knowledge.testTitle')}
            </CardTitle>
            <CardDescription>{t('knowledge.testDesc')}</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <Select value={testAvatar} onValueChange={setTestAvatar}>
                <SelectTrigger className='w-52'>
                  <SelectValue placeholder={t('knowledge.selectAvatar')} />
                </SelectTrigger>
                <SelectContent>
                  {avatars.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} (#{a.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => void runSearch()}
                disabled={searching || !testAvatar || !query.trim()}
              >
                {searching ? (
                  <LoaderCircle className='size-4 animate-spin' />
                ) : (
                  <Search className='size-4' />
                )}
                {t('knowledge.testSearch')}
              </Button>
            </div>
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('knowledge.testPlaceholder')}
              rows={3}
            />
            {results.length > 0 && (
              <div className='flex flex-col gap-2'>
                {results.map((r, i) => (
                  <div
                    key={i}
                    className='rounded-lg border bg-muted/30 p-3 text-sm'
                  >
                    <p className='mb-1 text-xs text-muted-foreground'>
                      #{i + 1} · {t('knowledge.score')} {Number(r.score).toFixed(4)}
                    </p>
                    <p className='whitespace-pre-wrap text-foreground'>
                      {r.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
