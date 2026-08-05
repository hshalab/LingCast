export type LiveSessionItem = {
  avatarId: number
  avatarName: string
  imageS3Url: string
  streamId: string
  status: string
}

export type LiveStatus = {
  avatarId: number
  streamId: string
  status: 'idle' | 'active' | 'pending'
  queueLength: number
  pending: string[]
  history: string[]
}

export type LiveMessageResponse = {
  reply: string
  chunkCount: number
}

export type ChatIdentity = {
  userId: number
  username: string
  isGuest: boolean
}

export type ChatMessage = {
  id: number
  avatarId: number
  userId: number
  username: string
  role: 'user' | 'bot'
  content: string
  createdAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // keep the status-based message
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export function listLiveSessions(): Promise<{ data: LiveSessionItem[] }> {
  return request('/api/live')
}

export function getLiveStatus(avatarId: number): Promise<LiveStatus> {
  return request(`/api/live/${avatarId}/status`)
}

export function sendMessage(
  avatarId: number,
  text: string,
  identity: ChatIdentity,
): Promise<LiveMessageResponse> {
  return request(`/api/live/${avatarId}/message`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      userId: identity.userId,
      username: identity.username,
    }),
  })
}

export function createGuestIdentity(): Promise<ChatIdentity> {
  return request('/api/chat/guest', { method: 'POST' })
}

export function registerIdentity(
  guestUserId: number,
  username: string,
  password: string,
): Promise<ChatIdentity> {
  return request('/api/chat/register', {
    method: 'POST',
    body: JSON.stringify({ guestUserId, username, password }),
  })
}

export function loginIdentity(
  guestUserId: number,
  username: string,
  password: string,
): Promise<ChatIdentity> {
  return request('/api/chat/login', {
    method: 'POST',
    body: JSON.stringify({ guestUserId, username, password }),
  })
}

export function fetchChatHistory(
  avatarId: number,
): Promise<{ data: ChatMessage[] }> {
  return request(`/api/chat/history?avatarId=${avatarId}`)
}
