import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Separator } from '@/components/ui/separator'

export function Settings() {
  const { t } = useTranslation()
  return (
    <>
      <Header>
        <div className='me-auto' />
        <ThemeSwitch />
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {t('settings.title')}
          </h1>
          <p className='text-muted-foreground'>{t('settings.subtitle')}</p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex w-full flex-col gap-4 lg:max-w-2xl'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}
