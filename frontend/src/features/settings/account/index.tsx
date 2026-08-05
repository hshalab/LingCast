import { LoaderCircle, Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminChangeName, adminChangePassword } from '@/lib/api'

function showError(e: unknown, fallback: string) {
  const message =
    typeof e === 'object' && e !== null && 'response' in e
      ? ((e as { response?: { data?: { error?: string } } }).response?.data?.error ??
        fallback)
      : fallback
  toast.error(message)
}

export function SettingsAccount() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || savingName) return
    setSavingName(true)
    try {
      await adminChangeName(name.trim())
      toast.success(t('settings.toastNameUpdated'))
      setName('')
    } catch (e) {
      showError(e, t('settings.toastNameFailed'))
    } finally {
      setSavingName(false)
    }
  }

  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!oldPassword || !newPassword || savingPassword) return
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.toastPasswordMismatch'))
      return
    }
    if (newPassword.length < 4) {
      toast.error(t('settings.toastPasswordShort'))
      return
    }
    setSavingPassword(true)
    try {
      await adminChangePassword(oldPassword, newPassword)
      toast.success(t('settings.toastPasswordUpdated'))
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      showError(e, t('settings.toastPasswordFailed'))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.changeName')}</CardTitle>
          <CardDescription>{t('settings.changeNameDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className='flex flex-col gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='admin-name'>{t('settings.newName')}</Label>
              <Input
                id='admin-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settings.namePlaceholder')}
              />
            </div>
            <Button type='submit' disabled={savingName || !name.trim()} className='self-start'>
              {savingName ? <LoaderCircle className='size-4 animate-spin' /> : <Save className='size-4' />}
              {t('settings.saveName')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.changePassword')}</CardTitle>
          <CardDescription>{t('settings.changePasswordDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className='flex flex-col gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='old-password'>{t('settings.oldPassword')}</Label>
              <Input
                id='old-password'
                type='password'
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete='current-password'
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='new-password'>{t('settings.newPassword')}</Label>
              <Input
                id='new-password'
                type='password'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete='new-password'
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='confirm-password'>{t('settings.confirmPassword')}</Label>
              <Input
                id='confirm-password'
                type='password'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete='new-password'
              />
            </div>
            <Button
              type='submit'
              disabled={savingPassword || !oldPassword || !newPassword}
              className='self-start'
            >
              {savingPassword ? (
                <LoaderCircle className='size-4 animate-spin' />
              ) : (
                <Save className='size-4' />
              )}
              {t('settings.changePasswordBtn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
