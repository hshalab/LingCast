'use client'

import Link from 'next/link'
import { Tv } from 'lucide-react'
import { useState } from 'react'
import AuthModal from '@/components/auth-modal'
import { useIdentity } from '@/lib/identity'

/** Shared audience-site navigation bar: brand + chat identity (register/login/logout). */
export default function NavHeader() {
  const { identity, loading: identityLoading, ensureIdentity, logout } = useIdentity()
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  return (
    <>
      <header className='sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur'>
        <div className='mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6'>
          <Link href='/' className='flex items-center gap-2'>
            <span className='grid size-9 place-items-center rounded-xl bg-blue-600 text-lg'>
              <Tv className='size-5 text-white' />
            </span>
            <span className='text-lg font-bold tracking-tight'>数字人直播间</span>
          </Link>

          <div className='flex items-center gap-2'>
            {identity ? (
              <>
                <span
                  className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs sm:flex ${
                    identity.isGuest
                      ? 'bg-zinc-800/80 text-zinc-300'
                      : 'bg-blue-600/20 text-blue-300'
                  }`}
                >
                  <span>{identity.isGuest ? '游客' : '账号'}</span>
                  <span className='font-medium'>{identity.username}</span>
                  <span className='opacity-60'>#{identity.userId}</span>
                </span>
                {identity.isGuest ? (
                  <>
                    <button
                      onClick={() => setAuthMode('register')}
                      className='rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500'
                    >
                      注册
                    </button>
                    <button
                      onClick={() => setAuthMode('login')}
                      className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500'
                    >
                      登录
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void logout()}
                    className='rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500'
                  >
                    退出
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => void ensureIdentity()}
                disabled={identityLoading}
                className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40'
              >
                {identityLoading ? '获取身份中…' : '获取游客身份'}
              </button>
            )}
          </div>
        </div>
      </header>

      {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} />}
    </>
  )
}
