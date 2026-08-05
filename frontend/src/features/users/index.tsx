import { RefreshCw, UserRound, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, type ChatUserItem } from '@/lib/api'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Users() {
  const [users, setUsers] = useState<ChatUserItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: ChatUserItem[] }>('/users')
      setUsers(data.data)
    } catch (error) {
      // keep previous data on refresh errors
      void error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
              <UsersRound className='size-6' />
              用户列表
            </h2>
            <p className='text-muted-foreground'>
              直播间的聊天用户：游客与已注册账号，含各自发送的消息数。
            </p>
          </div>
          <Button variant='outline' size='sm' onClick={() => { setLoading(true); void load() }}>
            <RefreshCw className='size-4' />
            刷新
          </Button>
        </div>

        <Card>
          <CardHeader className='gap-1'>
            <CardTitle>全部用户</CardTitle>
            <CardDescription>共 {users.length} 人（最多显示最近 500）</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className='py-10 text-center text-sm text-muted-foreground'>加载中…</p>
            ) : users.length === 0 ? (
              <div className='flex flex-col items-center gap-2 py-10 text-center text-muted-foreground'>
                <UserRound className='size-8' />
                <p className='text-sm'>还没有聊天用户</p>
                <p className='text-xs'>观众进入直播间后会自动生成游客身份。</p>
              </div>
            ) : (
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='border-b text-left text-muted-foreground'>
                      <th className='py-2 pe-4 font-medium'>ID</th>
                      <th className='py-2 pe-4 font-medium'>用户名</th>
                      <th className='py-2 pe-4 font-medium'>类型</th>
                      <th className='py-2 pe-4 font-medium'>消息数</th>
                      <th className='py-2 font-medium'>注册时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className='border-b last:border-0 hover:bg-muted/40'>
                        <td className='py-2 pe-4 text-muted-foreground'>#{u.id}</td>
                        <td className='py-2 pe-4 font-medium'>{u.username}</td>
                        <td className='py-2 pe-4'>
                          <Badge variant={u.isGuest ? 'outline' : 'default'}>
                            {u.isGuest ? '游客' : '账号'}
                          </Badge>
                        </td>
                        <td className='py-2 pe-4 text-muted-foreground'>{u.messageCount}</td>
                        <td className='py-2 text-muted-foreground'>{formatDate(u.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
