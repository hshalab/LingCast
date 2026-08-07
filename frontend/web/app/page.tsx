import PayPalCheckout from '@/components/paypal-button'
import AuthHeader from '@/components/auth-header'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">灵播 LingCast 1v1</h1>
        <p className="mt-3 text-zinc-400">
          与数字人一对一视频聊天，按分钟付费体验。
        </p>
      </section>

      <section className="w-full">
        <AuthHeader />
      </section>

      <section className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="text-lg font-semibold">开通体验（PayPal）</h2>
        <p className="mt-1 text-sm text-zinc-400">
          设置 <code className="rounded bg-zinc-800 px-1.5 py-0.5">NEXT_PUBLIC_PAYPAL_CLIENT_ID</code>{' '}
          后显示 PayPal 支付按钮。
        </p>
        <div className="mt-4">
          <PayPalCheckout />
        </div>
      </section>

      <footer className="text-xs text-zinc-600">
        LingCast · 1v1 Web Client（Next.js + PayPal + zustand）
      </footer>
    </main>
  )
}
