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
): Promise<LiveMessageResponse> {
  return request(`/api/live/${avatarId}/message`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}
