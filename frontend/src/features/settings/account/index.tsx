import { LoaderCircle, Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
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
      toast.success('名字已更新')
      setName('')
    } catch (e) {
      showError(e, '修改名字失败')
    } finally {
      setSavingName(false)
    }
  }

  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!oldPassword || !newPassword || savingPassword) return
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }
    if (newPassword.length < 4) {
      toast.error('新密码至少 4 位')
      return
    }
    setSavingPassword(true)
    try {
      await adminChangePassword(oldPassword, newPassword)
      toast.success('密码已修改，下次登录请使用新密码')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      showError(e, '修改密码失败')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>修改名字</CardTitle>
          <CardDescription>显示在后台侧边栏与登录态上的名字。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className='flex flex-col gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='admin-name'>新名字</Label>
              <Input
                id='admin-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='例如：平台管理员'
              />
            </div>
            <Button type='submit' disabled={savingName || !name.trim()} className='self-start'>
              {savingName ? <LoaderCircle className='size-4 animate-spin' /> : <Save className='size-4' />}
              保存名字
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>需要先输入原密码，新密码至少 4 位。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className='flex flex-col gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='old-password'>原密码</Label>
              <Input
                id='old-password'
                type='password'
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete='current-password'
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='new-password'>新密码</Label>
              <Input
                id='new-password'
                type='password'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete='new-password'
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='confirm-password'>确认新密码</Label>
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
              修改密码
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
