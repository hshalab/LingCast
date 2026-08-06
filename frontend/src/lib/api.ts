import axios from 'axios'

export type Avatar = {
  id: number
  name: string
  imageS3Key: string
  imageS3Url: string
  voiceId: string
  category: string
  baseVideoS3Key?: string
  baseVideoS3Url?: string
  status: 'initializing' | 'ready' | 'failed' | 'skipped'
  liveSettings?: LiveSettings
  age?: number
  heightCm?: number
  weightKg?: number
  ethnicity?: string
  relationshipStatus?: string
  personality?: string
  initQueuePos?: number
  createdAt: string
}

export type LiveSettings = {
  subtitleEnabled: boolean
  subtitleFont: string
  subtitlePosition: 'bottom' | 'top'
  subtitleBorder: number
  subtitleSize: number
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type BroadcastTask = {
  id: number
  avatarId: number
  scriptText: string
  status: TaskStatus
  outputVideoS3Url?: string
  errorMessage?: string
  avatarName?: string
  createdAt: string
  updatedAt: string
}

export type LiveStatus = {
  avatarId: number
  streamId: string
  status: 'idle' | 'active' | 'pending'
  queueLength: number
  pending: string[]
  history: string[]
}

export type LiveSessionItem = {
  avatarId: number
  avatarName: string
  imageS3Url: string
  streamId: string
  status: string
}

export type KnowledgeStatus = 'pending' | 'indexed' | 'failed'

export type KnowledgeItem = {
  id: number
  avatarId: number
  content: string
  status: KnowledgeStatus
  filename?: string
  createdAt: string
}

export type LiveMessageResponse = {
  reply: string
  chunkCount: number
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

export type ChatUserItem = {
  id: number
  username: string
  isGuest: boolean
  messageCount: number
  createdAt: string
}

// In the dockerized setup the app and the API share the nginx origin, so the
// base URL defaults to '' (same origin, proxied via /api). For local Vite
// development set VITE_API_BASE_URL to the nginx/app origin, e.g.
// http://localhost:8080 (see frontend/.env.example).
const baseURL = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`

export const api = axios.create({ baseURL })

// Tell the backend which language to use for error messages.
api.interceptors.request.use((config) => {
  const lang = localStorage.getItem('lingcast-lang')
  config.headers['Accept-Language'] = lang === 'en' ? 'en' : 'zh-CN'
  return config
})

export async function adminLogin(username: string, password: string) {
  const { data } = await api.post<{ username: string; name: string }>('/admin/login', {
    username,
    password,
  })
  return data
}

export async function listKnowledge(avatarId: number): Promise<KnowledgeItem[]> {
  const { data } = await api.get<{ data: KnowledgeItem[] }>(
    `/avatars/${avatarId}/knowledge`,
  )
  return data.data
}

export async function createKnowledgeText(
  avatarId: number,
  text: string,
): Promise<KnowledgeItem> {
  const form = new FormData()
  form.append('text', text)
  const { data } = await api.post<KnowledgeItem>(
    `/avatars/${avatarId}/knowledge`,
    form,
  )
  return data
}

export async function createKnowledgeFile(
  avatarId: number,
  file: File,
): Promise<KnowledgeItem> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<KnowledgeItem>(
    `/avatars/${avatarId}/knowledge`,
    form,
  )
  return data
}

export async function deleteKnowledge(avatarId: number, knowledgeId: number) {
  await api.delete(`/avatars/${avatarId}/knowledge/${knowledgeId}`)
}

export async function adminMe() {
  const { data } = await api.get<{ username: string; name: string }>('/admin/me')
  return data
}

export async function adminLogout() {
  await api.post('/admin/logout')
}

export async function adminChangeName(name: string) {
  const { data } = await api.post<{ name: string }>('/admin/change-name', { name })
  return data
}

export async function adminChangePassword(oldPassword: string, newPassword: string) {
  await api.post('/admin/change-password', { oldPassword, newPassword })
}
