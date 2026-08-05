import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { adminLogin } from '@/lib/api'

export function AdminLogin() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await adminLogin(username.trim(), password)
      await navigate({ to: '/avatar-library', replace: true })
    } catch (e) {
      const message =
        typeof e === 'object' && e !== null && 'response' in e
          ? ((e as { response?: { data?: { error?: string } } }).response?.data?.error ??
            '登录失败，请稍后重试')
          : '登录失败，请稍后重试'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex min-h-svh items-center justify-center bg-muted/40 p-4'>
      <Card className='w-full max-w-sm'>
        <CardHeader className='items-center text-center'>
          <div className='mb-2 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground'>
            <ShieldCheck className='size-6' />
          </div>
          <CardTitle className='text-xl'>管理员登录</CardTitle>
          <CardDescription>登录后才能访问数字人管理后台</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className='flex flex-col gap-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='login-username'>用户名</Label>
              <Input
                id='login-username'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder='admin'
                autoFocus
                autoComplete='username'
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='login-password'>密码</Label>
              <Input
                id='login-password'
                type='password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='••••••••'
                autoComplete='current-password'
              />
            </div>
            {error && <p className='text-sm text-destructive'>{error}</p>}
            <Button type='submit' disabled={busy || !username.trim() || !password}>
              {busy ? <LoaderCircle className='size-4 animate-spin' /> : null}
              登录
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
