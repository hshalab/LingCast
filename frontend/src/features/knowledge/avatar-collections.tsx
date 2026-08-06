import { BookOpen, ChevronRight, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  listKnowledgeCollections,
  type KnowledgeCollection,
} from '@/lib/api'

/**
 * Compact knowledge-base overview for one avatar, used inside Avatar Studio
 * (edit mode). Shows its collections and links to the full management page.
 */
export function AvatarCollections({ avatarId }: { avatarId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<KnowledgeCollection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    listKnowledgeCollections({ avatarId })
      .then((data) => {
        if (alive) setItems(data)
      })
      .catch(() => {
        // keep previous list
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [avatarId])

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <BookOpen className='size-5' />
          {t('studio.knowledgeTitle')}
        </CardTitle>
        <CardDescription>{t('studio.knowledgeDesc')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {loading ? (
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <LoaderCircle className='size-4 animate-spin' />
            {t('common.loading')}
          </div>
        ) : items.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {t('studio.knowledgeEmpty')}
          </p>
        ) : (
          <div className='flex flex-col divide-y'>
            {items.map((c) => (
              <div
                key={c.id}
                className='flex items-center justify-between gap-2 py-2 text-sm'
              >
                <span className='truncate'>{c.name}</span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {t('knowledge.documentCount', { count: c.documentCount })}
                </span>
              </div>
            ))}
          </div>
        )}
        <Button
          variant='outline'
          className='self-start'
          onClick={() =>
            void navigate({
              to: '/knowledge',
              search: { avatarId: String(avatarId) },
            })
          }
        >
          {t('studio.manageKnowledge')}
          <ChevronRight className='size-4' />
        </Button>
      </CardContent>
    </Card>
  )
}
