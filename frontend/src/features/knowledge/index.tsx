import { BookOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, type Avatar } from '@/lib/api'
import { KnowledgePanel } from './knowledge-panel'

/**
 * Knowledge management page: pick an avatar, then manage its private
 * knowledge base (text / .txt/.pdf -> chunked + embedded by the RAG worker).
 */
export function Knowledge({ initialAvatarId }: { initialAvatarId?: string }) {
  const { t } = useTranslation()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [selected, setSelected] = useState('')

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Avatar[] }>('/avatars')
      setAvatars(data.data)
      if (!selected && data.data.length > 0) {
        const preset = initialAvatarId
          ? data.data.find((a) => String(a.id) === initialAvatarId)
          : undefined
        setSelected(String((preset ?? data.data[0]).id))
      }
    } catch {
      // page shows empty state
    }
  }, [initialAvatarId, selected])

  useEffect(() => {
    void load()
  }, [load])

  const avatarId = Number(selected)

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
            <BookOpen className='size-6' />
            {t('knowledge.pageTitle')}
          </h2>
          <p className='text-muted-foreground'>{t('knowledge.pageSubtitle')}</p>
        </div>

        <div className='max-w-md'>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder={t('knowledge.selectAvatar')} />
            </SelectTrigger>
            <SelectContent>
              {avatars.map((avatar) => (
                <SelectItem key={avatar.id} value={String(avatar.id)}>
                  {avatar.name} (#{avatar.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {avatarId > 0 ? (
          <KnowledgePanel avatarId={avatarId} />
        ) : (
          <p className='py-10 text-center text-sm text-muted-foreground'>
            {t('knowledge.noAvatar')}
          </p>
        )}
      </Main>
    </>
  )
}
