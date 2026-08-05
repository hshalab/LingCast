'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  createGuestIdentity,
  loginIdentity,
  registerIdentity,
  type ChatIdentity,
} from '@/lib/api'

const IDENTITY_KEY = 'tav_chat_identity'

function loadIdentity(): ChatIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    return raw ? (JSON.parse(raw) as ChatIdentity) : null
  } catch {
    return null
  }
}

function saveIdentity(identity: ChatIdentity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
}

type IdentityContextValue = {
  identity: ChatIdentity | null
  loading: boolean
  ensureIdentity: () => Promise<ChatIdentity | null>
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const IdentityContext = createContext<IdentityContextValue | null>(null)

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<ChatIdentity | null>(null)
  const [loading, setLoading] = useState(true)

  const ensureIdentity = useCallback(async (): Promise<ChatIdentity | null> => {
    const cached = loadIdentity()
    if (cached) {
      setIdentity(cached)
      return cached
    }
    try {
      const guest = await createGuestIdentity()
      saveIdentity(guest)
      setIdentity(guest)
      return guest
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    ensureIdentity().finally(() => setLoading(false))
  }, [ensureIdentity])

  const login = useCallback(
    async (username: string, password: string) => {
      const current = identity ?? loadIdentity()
      if (!current) throw new Error('身份未就绪，请稍后重试')
      const next = await loginIdentity(current.userId, username, password)
      saveIdentity(next)
      setIdentity(next)
    },
    [identity],
  )

  const register = useCallback(
    async (username: string, password: string) => {
      const current = identity ?? loadIdentity()
      if (!current) throw new Error('身份未就绪，请稍后重试')
      const next = await registerIdentity(current.userId, username, password)
      saveIdentity(next)
      setIdentity(next)
    },
    [identity],
  )

  const logout = useCallback(async () => {
    localStorage.removeItem(IDENTITY_KEY)
    setIdentity(null)
    await ensureIdentity()
  }, [ensureIdentity])

  return (
    <IdentityContext.Provider
      value={{ identity, loading, ensureIdentity, login, register, logout }}
    >
      {children}
    </IdentityContext.Provider>
  )
}

export function useIdentity() {
  const ctx = useContext(IdentityContext)
  if (!ctx) throw new Error('useIdentity must be used within IdentityProvider')
  return ctx
}
