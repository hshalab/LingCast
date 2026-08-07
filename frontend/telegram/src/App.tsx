import WebApp from '@twa-dev/sdk'

export default function App() {
  const user = WebApp.initDataUnsafe?.user

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-zinc-100">
      <h1 className="text-2xl font-bold tracking-tight">灵播 LingCast TG</h1>
      <p className="text-sm text-zinc-400">
        {user
          ? `你好，${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`
          : '未获取到 Telegram 用户信息'}
      </p>
      <p className="text-xs text-zinc-600">
        Telegram Mini App · React + Vite + Tailwind
      </p>
    </main>
  )
}
