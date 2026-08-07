import {
  BookOpen,
  Eye,
  FolderPlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  createKnowledgeCollection,
  deleteKnowledgeCollection,
  listKnowledgeCollections,
  renameKnowledgeCollection,
  type KnowledgeCollection,
} from '@/lib/api'

function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/**
 * Knowledge base management: avatar -> collection (知识库) -> documents.
 * This page lists the collections (zvec "Collection" concept) and lets the
 * admin create/rename/delete them; documents live inside a collection detail.
 */
export function Knowledge() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [collections, setCollections] = useState<KnowledgeCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Rename dialog
  const [renameTarget, setRenameTarget] = useState<KnowledgeCollection | null>(null)
  const [renameName, setRenameName] = useState('')

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeCollection | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCollections(
        await listKnowledgeCollections({ q: keyword.trim() || undefined }),
      )
    } catch {
      toast.error(t('knowledge.toastListFailed'))
    } finally {
      setLoading(false)
    }
  }, [keyword, t])

  useEffect(() => {
    void load()
  }, [load])

  const submitCreate = async () => {
    if (!createName.trim() || submitting) return
    setSubmitting(true)
    try {
      await createKnowledgeCollection(createName.trim())
      toast.success(t('knowledge.toastCreated'))
      setCreateName('')
      setCreateOpen(false)
      void load()
    } catch {
      toast.error(t('knowledge.toastCreateFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const openRename = (c: KnowledgeCollection) => {
    setRenameTarget(c)
    setRenameName(c.name)
  }

  const submitRename = async () => {
    if (!renameTarget || !renameName.trim()) return
    try {
      await renameKnowledgeCollection(renameTarget.id, renameName.trim())
      toast.success(t('knowledge.toastRenamed'))
      setRenameTarget(null)
      void load()
    } catch {
      toast.error(t('knowledge.toastRenameFailed'))
    }
  }

  const submitDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteKnowledgeCollection(deleteTarget.id)
      toast.success(t('knowledge.toastDeleted'))
      setDeleteTarget(null)
      void load()
    } catch {
      toast.error(t('knowledge.toastDeleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

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
              <BookOpen className='size-6' />
              {t('knowledge.pageTitle')}
            </h2>
            <p className='text-muted-foreground'>{t('knowledge.pageSubtitle')}</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <FolderPlus className='size-4' />
            {t('knowledge.createCollection')}
          </Button>
        </div>

        <Card>
          <CardHeader className='flex-row items-center justify-between gap-3'>
            <CardTitle>{t('knowledge.collectionList')}</CardTitle>
            <Button variant='outline' size='sm' onClick={() => void load()}>
              <RefreshCw className='size-4' />
              {t('common.refresh')}
            </Button>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <div className='flex flex-wrap items-center gap-3'>
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t('knowledge.filterKeyword')}
                className='w-64'
              />
            </div>

            {loading ? (
              <div className='flex items-center justify-center gap-2 py-10 text-muted-foreground'>
                <LoaderCircle className='size-5 animate-spin' />
                {t('common.loading')}
              </div>
            ) : collections.length === 0 ? (
              <div className='py-10 text-center text-sm text-muted-foreground'>
                {t('knowledge.collectionEmpty')}
              </div>
            ) : (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                {collections.map((c) => (
                  <Card key={c.id} className='flex flex-col'>
                    <CardHeader className='pb-2'>
                      <CardTitle className='flex items-center gap-2 text-base'>
                        <BookOpen className='size-4 text-primary' />
                        <span className='truncate'>{c.name}</span>
                      </CardTitle>
                      <CardDescription>
                        {t('knowledge.documentCount', { count: c.documentCount })}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className='flex flex-1 flex-col justify-between gap-3 pt-0'>
                      <div className='text-xs text-muted-foreground'>
                        {formatTime(c.updatedAt)}
                      </div>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Button
                          size='sm'
                          onClick={() =>
                            void navigate({ to: '/knowledge/$id', params: { id: String(c.id) } })
                          }
                        >
                          <Eye className='size-4' />
                          {t('knowledge.openDetail')}
                        </Button>
                        <Button size='sm' variant='outline' onClick={() => openRename(c)}>
                          <Pencil className='size-4' />
                          {t('knowledge.rename')}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='text-destructive'
                          onClick={() => setDeleteTarget(c)}
                        >
                          <Trash2 className='size-4' />
                          {t('knowledge.delete')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Main>

      {/* Create collection */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('knowledge.createCollection')}</DialogTitle>
            <DialogDescription>{t('knowledge.createCollectionDesc')}</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <label className='text-sm font-medium'>{t('knowledge.collectionName')}</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('knowledge.collectionNamePlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => void submitCreate()}
              disabled={!createName.trim() || submitting}
            >
              {submitting && <LoaderCircle className='size-4 animate-spin' />}
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename collection */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('knowledge.rename')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder={t('knowledge.collectionNamePlaceholder')}
          />
          <DialogFooter>
            <Button onClick={() => void submitRename()} disabled={!renameName.trim()}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete collection */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('knowledge.delete')}
        desc={
          deleteTarget
            ? t('knowledge.deleteCollectionDesc', { name: deleteTarget.name })
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
