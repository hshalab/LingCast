import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { adminLogout } from '@/lib/api'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const { t } = useTranslation()
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
      title={t('signout.title')}
      desc={t('signout.desc')}
      confirmText={t('signout.confirm')}
      cancelBtnText={t('common.cancel')}
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
