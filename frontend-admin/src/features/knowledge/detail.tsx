import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
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
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  createKnowledgeDocumentFile,
  createKnowledgeDocumentText,
  deleteKnowledgeDocument,
  listDocumentChunks,
  listKnowledgeCollections,
  listKnowledgeDocuments,
  searchKnowledge,
  type KnowledgeCollection,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
} from '@/lib/api'

function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/**
 * One knowledge collection (知识库) detail: manage its documents (Document) —
 * paste text or upload .txt/.pdf, delete documents, and run a retrieval test
 * scoped to this collection.
 */
export function KnowledgeDetail({ collectionId }: { collectionId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [collection, setCollection] = useState<KnowledgeCollection | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)

  // Add document
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Delete document
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocument | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Chunk preview (查看分块)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [chunksMap, setChunksMap] = useState<Record<number, KnowledgeChunk[]>>({})
  const [chunksLoading, setChunksLoading] = useState(false)

  // Retrieval test
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    try {
      const all = await listKnowledgeCollections()
      setCollection(all.find((c) => c.id === collectionId) ?? null)
      setDocuments(await listKnowledgeDocuments(collectionId))
    } catch {
      toast.error(t('knowledge.toastListFailed'))
    } finally {
      setLoading(false)
    }
  }, [collectionId, t])

  useEffect(() => {
    void load()
  }, [load])

  const submitText = async () => {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      await createKnowledgeDocumentText(collectionId, text.trim())
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
      await createKnowledgeDocumentFile(collectionId, file)
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

  const submitDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteKnowledgeDocument(collectionId, deleteTarget.id)
      toast.success(t('knowledge.toastDeleted'))
      setDeleteTarget(null)
      void load()
    } catch {
      toast.error(t('knowledge.toastDeleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  const toggleChunks = async (doc: KnowledgeDocument) => {
    if (expandedId === doc.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(doc.id)
    if (!chunksMap[doc.id]) {
      setChunksLoading(true)
      try {
        const chunks = await listDocumentChunks(collectionId, doc.id)
        setChunksMap((prev) => ({ ...prev, [doc.id]: chunks }))
      } catch {
        toast.error(t('knowledge.toastChunksFailed'))
      } finally {
        setChunksLoading(false)
      }
    }
  }

  const runSearch = async () => {
    if (!query.trim() || searching) return
    setSearching(true)
    try {
      setResults(await searchKnowledge({ collectionId }, query.trim(), 3))
    } catch {
      toast.error(t('knowledge.toastSearchFailed'))
    } finally {
      setSearching(false)
    }
  }

  const statusVariant = (s: KnowledgeDocument['status']) =>
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
            <Button
              variant='ghost'
              size='sm'
              className='mb-2 -ms-2 text-muted-foreground'
              onClick={() => void navigate({ to: '/knowledge' })}
            >
              <ArrowLeft className='size-4' />
              {t('knowledge.back')}
            </Button>
            <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <BookOpen className='size-6' />
              {collection?.name ?? '…'}
            </h2>
            <p className='text-muted-foreground'>
              {t('knowledge.documentCount', { count: documents.length })}
            </p>
          </div>
        </div>

        <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
          {/* Add document */}
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <FileText className='size-5' />
                {t('knowledge.addDocument')}
              </CardTitle>
              <CardDescription>{t('knowledge.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
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
                  {submitting && <LoaderCircle className='size-4 animate-spin' />}
                  {t('knowledge.addText')}
                </Button>
              </div>
              <div className='flex items-center gap-3'>
                <input
                  ref={fileRef}
                  type='file'
                  accept='.txt,.pdf'
                  className='hidden'
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className='size-4' />
                  {t('knowledge.upload')}
                </Button>
                {file ? (
                  <span className='truncate text-sm'>{file.name}</span>
                ) : (
                  <span className='text-xs text-muted-foreground'>{t('knowledge.fileHint')}</span>
                )}
                {file && (
                  <Button
                    type='button'
                    onClick={() => void submitFile()}
                    disabled={submitting}
                  >
                    {t('common.confirm')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Retrieval test */}
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Search className='size-5' />
                {t('knowledge.testTitle')}
              </CardTitle>
              <CardDescription>{t('knowledge.testDesc')}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-3'>
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('knowledge.testPlaceholder')}
                rows={3}
              />
              <Button
                onClick={() => void runSearch()}
                disabled={!query.trim() || searching}
                className='self-start'
              >
                {searching ? (
                  <LoaderCircle className='size-4 animate-spin' />
                ) : (
                  <Search className='size-4' />
                )}
                {t('knowledge.testSearch')}
              </Button>
              {results.length > 0 && (
                <div className='flex flex-col gap-2'>
                  {results.map((r, i) => (
                    <div
                      key={i}
                      className='rounded-lg border bg-muted/30 p-3 text-sm'
                    >
                      <p className='mb-1 text-xs text-muted-foreground'>
                        #{i + 1} · {t('knowledge.score')}{' '}
                        {Number(r.score).toFixed(4)}
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
        </div>

        {/* Documents */}
        <Card>
          <CardHeader>
            <CardTitle>{t('knowledge.documents')}</CardTitle>
            <CardDescription>{t('knowledge.documentsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className='flex items-center justify-center gap-2 py-10 text-muted-foreground'>
                <LoaderCircle className='size-5 animate-spin' />
                {t('common.loading')}
              </div>
            ) : documents.length === 0 ? (
              <div className='py-10 text-center text-sm text-muted-foreground'>
                {t('knowledge.emptyDocuments')}
              </div>
            ) : (
              <div className='flex flex-col divide-y'>
                {documents.map((d) => (
                  <div key={d.id} className='py-3'>
                    <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-sm font-medium'>
                            {d.filename || t('knowledge.textDocument')}
                          </span>
                          <Badge variant={statusVariant(d.status)}>
                            {t(`knowledge.status.${d.status}`)}
                          </Badge>
                        </div>
                        <p className='mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground'>
                          {d.content || t('knowledge.pendingContent')}
                        </p>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {formatTime(d.createdAt)}
                        </p>
                      </div>
                      <div className='flex shrink-0 items-center gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => void toggleChunks(d)}
                        >
                          {expandedId === d.id ? (
                            <ChevronDown className='size-4' />
                          ) : (
                            <ChevronRight className='size-4' />
                          )}
                          {t('knowledge.viewChunks')}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='text-destructive'
                          onClick={() => setDeleteTarget(d)}
                        >
                          <Trash2 className='size-4' />
                          {t('knowledge.delete')}
                        </Button>
                      </div>
                    </div>

                    {expandedId === d.id && (
                      <div className='mt-3 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3'>
                        <p className='text-xs font-medium text-muted-foreground'>
                          {t('knowledge.chunksOf', {
                            count: chunksMap[d.id]?.length ?? 0,
                          })}
                        </p>
                        {chunksLoading && !chunksMap[d.id] ? (
                          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                            <LoaderCircle className='size-4 animate-spin' />
                            {t('common.loading')}
                          </div>
                        ) : (chunksMap[d.id] ?? []).length === 0 ? (
                          <p className='text-sm text-muted-foreground'>
                            {t('knowledge.chunksEmpty')}
                          </p>
                        ) : (
                          (chunksMap[d.id] ?? []).map((c) => (
                            <div key={c.index} className='flex gap-2 text-sm'>
                              <Badge
                                variant='outline'
                                className='h-fit shrink-0 text-xs'
                              >
                                #{c.index + 1}
                              </Badge>
                              <p className='whitespace-pre-wrap text-foreground'>
                                {c.text}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Main>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('knowledge.deleteDocument')}
        desc={
          deleteTarget
            ? t('knowledge.deleteDocumentDesc', {
                name: deleteTarget.filename || t('knowledge.textDocument'),
              })
            : ''
        }
        confirmText={deleting ? t('knowledge.deleting') : t('knowledge.deleteConfirm')}
        destructive
        isLoading={deleting}
        handleConfirm={() => void submitDelete()}
      />
    </>
  )
}
