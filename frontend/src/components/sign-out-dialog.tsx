import { useNavigate } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { adminLogout } from '@/lib/api'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()

  const handleSignOut = async () => {
    try {
      await adminLogout()
    } catch {
      // clear the cookie anyway
    }
    await navigate({ to: '/login', replace: true })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='退出登录'
      desc='确定要退出管理员登录吗？退出后需要重新登录才能访问后台。'
      confirmText='退出'
      cancelBtnText='取消'
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
