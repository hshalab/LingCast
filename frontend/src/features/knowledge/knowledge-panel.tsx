import { BookOpen, FileText, LoaderCircle, Plus, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import {
  createKnowledgeFile,
  createKnowledgeText,
  deleteKnowledge,
  listKnowledge,
  type KnowledgeItem,
} from '@/lib/api'

/**
 * Private knowledge base for one avatar. Raw text or .txt/.pdf files are
 * uploaded here; the Python RAG worker chunks and embeds them locally
 * (strictly isolated per avatar_id).
 */
export function KnowledgePanel({ avatarId }: { avatarId: number }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setItems(await listKnowledge(avatarId))
    } catch {
      // keep previous list
    } finally {
      setLoading(false)
    }
  }, [avatarId])

  useEffect(() => {
    void load()
  }, [load])

  const submitText = async () => {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      await createKnowledgeText(avatarId, text.trim())
      toast.success(t('knowledge.toastAdded'))
      setText('')
      void load()
    } catch {
      toast.error(t('knowledge.toastFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const submitFile = async () => {
    if (!file || submitting) return
    setSubmitting(true)
    try {
      await createKnowledgeFile(avatarId, file)
      toast.success(t('knowledge.toastAdded'))
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      void load()
    } catch {
      toast.error(t('knowledge.toastFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (item: KnowledgeItem) => {
    try {
      await deleteKnowledge(avatarId, item.id)
      void load()
    } catch {
      toast.error(t('knowledge.toastDeleteFailed'))
    }
  }

  const statusVariant = (s: KnowledgeItem['status']) =>
    s === 'indexed' ? 'secondary' : s === 'failed' ? 'destructive' : 'outline'

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <BookOpen className='size-5' />
          {t('knowledge.title')}
        </CardTitle>
        <CardDescription>{t('knowledge.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {/* Raw text */}
        <div className='flex flex-col gap-2'>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('knowledge.textPlaceholder')}
            rows={4}
          />
          <Button
            type='button'
            variant='outline'
            onClick={() => void submitText()}
            disabled={submitting || !text.trim()}
            className='self-start'
          >
            {submitting ? (
              <LoaderCircle className='size-4 animate-spin' />
            ) : (
              <Plus className='size-4' />
            )}
            {t('knowledge.addText')}
          </Button>
        </div>

        {/* File upload (.txt / .pdf) */}
        <div className='flex flex-col gap-2 rounded-lg border bg-muted/30 p-3'>
          <p className='flex items-center gap-1.5 text-sm text-muted-foreground'>
            <FileText className='size-4' />
            {t('knowledge.fileHint')}
          </p>
          <div className='flex items-center gap-2'>
            <input
              ref={fileRef}
              type='file'
              accept='.txt,.pdf,text/plain,application/pdf'
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className='min-w-0 flex-1 text-sm'
            />
            <Button
              type='button'
              onClick={() => void submitFile()}
              disabled={submitting || !file}
              size='sm'
            >
              <Upload className='size-4' />
              {t('knowledge.upload')}
            </Button>
          </div>
        </div>

        {/* Existing sources */}
        <div className='flex flex-col gap-2'>
          {loading ? (
            <p className='py-4 text-center text-sm text-muted-foreground'>
              {t('common.loading')}
            </p>
          ) : items.length === 0 ? (
            <p className='py-4 text-center text-sm text-muted-foreground'>
              {t('knowledge.empty')}
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className='flex items-start justify-between gap-3 rounded-lg border p-3'
              >
                <div className='min-w-0'>
                  <div className='mb-1 flex items-center gap-2'>
                    <Badge variant={statusVariant(item.status)}>
                      {t(`knowledge.status.${item.status}`)}
                    </Badge>
                    {item.filename && (
                      <span className='truncate text-xs text-muted-foreground'>
                        {item.filename}
                      </span>
                    )}
                  </div>
                  <p className='line-clamp-3 whitespace-pre-wrap text-sm text-foreground'>
                    {item.content || t('knowledge.pendingContent')}
                  </p>
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='shrink-0 text-destructive'
                  title={t('common.delete')}
                  onClick={() => void remove(item)}
                >
                  <Trash2 className='size-4' />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
