'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import GoogleLoginButton from './google-login-button'

interface User {
  id: number
  username: string
  googleId?: string
}

interface AuthState {
  user: User | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setLoading: (isLoading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
}))

export default function AuthHeader() {
  const { user, isLoading, setUser, setLoading } = useAuthStore()

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8085'
        const res = await fetch(`${backendUrl}/api/auth/me`, { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setUser(data.user || data)
        } else {
          setUser(null)
        }
      } catch (err) {
        setUser(null)
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [setUser, setLoading])

  if (isLoading) return <div className="h-14 w-full animate-pulse rounded-xl bg-zinc-800/50" />

  if (user) {
    return (
      <div className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 font-bold text-white">
            {user.username?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{user.username}</p>
            <p className="text-xs text-zinc-400">已登录 Web Client</p>
          </div>
        </div>
        <button
          onClick={() => {
            const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8085'
            window.location.href = `${backendUrl}/api/auth/logout`
          }}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
        >
          退出
        </button>
      </div>
    )
  }

  return <GoogleLoginButton />
}
