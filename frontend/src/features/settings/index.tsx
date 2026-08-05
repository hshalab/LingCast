import { Outlet } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Separator } from '@/components/ui/separator'

export function Settings() {
  return (
    <>
      <Header>
        <div className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>账号设置</h1>
          <p className='text-muted-foreground'>修改管理员显示名字与登录密码。</p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex w-full flex-col gap-4 lg:max-w-2xl'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}
