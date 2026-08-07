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

export type AvatarVideo = {
  id: number
  avatarId: number
  name: string
  s3Key: string
  s3Url: string
  source: 'system' | 'upload'
  isDefault?: boolean
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
  progress?: number
  stage?: string
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

export type KnowledgeCollection = {
  id: number
  avatarId: number
  avatarName?: string
  name: string
  documentCount: number
  createdAt: string
  updatedAt: string
}

export type KnowledgeDocument = {
  id: number
  collectionId: number
  content: string
  status: KnowledgeStatus
  filename?: string
  createdAt: string
}

export type KnowledgeSearchResult = {
  content: string
  score: string
}

export type KnowledgeChunk = {
  index: number
  text: string
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

// Session expiry fallback: any 401 (except the login attempt itself) bounces
// back to the login page. The route guard also verifies once on first entry.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status
    const url: string = error.config?.url ?? ''
    if (
      status === 401 &&
      !url.includes('/admin/login') &&
      window.location.pathname !== '/login'
    ) {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export async function adminLogin(username: string, password: string) {
  const { data } = await api.post<{ username: string; name: string }>('/admin/login', {
    username,
    password,
  })
  return data
}

// ---- Knowledge collections (知识库) ----
export async function listKnowledgeCollections(params?: {
  avatarId?: number
  q?: string
}): Promise<KnowledgeCollection[]> {
  const { data } = await api.get<{ data: KnowledgeCollection[] }>(
    '/knowledge-collections',
    { params },
  )
  return data.data
}

export async function createKnowledgeCollection(
  avatarId: number,
  name: string,
): Promise<KnowledgeCollection> {
  const { data } = await api.post<{ data: KnowledgeCollection }>(
    `/avatars/${avatarId}/knowledge-collections`,
    { name },
  )
  return data.data
}

export async function renameKnowledgeCollection(
  id: number,
  name: string,
): Promise<KnowledgeCollection> {
  const { data } = await api.put<{ data: KnowledgeCollection }>(
    `/knowledge-collections/${id}`,
    { name },
  )
  return data.data
}

export async function deleteKnowledgeCollection(id: number) {
  await api.delete(`/knowledge-collections/${id}`)
}

export type ChatLogItem = {
  id: number
  avatarId: number
  avatarName?: string
  userId: number
  username: string
  role: 'user' | 'bot'
  content: string
  ragHit: boolean
  ragSources?: string[]
  createdAt: string
}

export type ChatLogPage = {
  data: ChatLogItem[]
  total: number
  page: number
  pageSize: number
}

export async function fetchChatLogs(params?: {
  avatarId?: number
  userId?: number
  date?: string
  q?: string
  page?: number
  pageSize?: number
}): Promise<ChatLogPage> {
  const { data } = await api.get<ChatLogPage>('/chat/logs', {
    params,
  })
  return data
}

// ---- Knowledge documents (文档) ----
export async function listKnowledgeDocuments(
  collectionId: number,
): Promise<KnowledgeDocument[]> {
  const { data } = await api.get<{ data: KnowledgeDocument[] }>(
    `/knowledge-collections/${collectionId}/documents`,
  )
  return data.data
}

export async function createKnowledgeDocumentText(
  collectionId: number,
  text: string,
): Promise<KnowledgeDocument> {
  const form = new FormData()
  form.append('text', text)
  const { data } = await api.post<{ data: KnowledgeDocument }>(
    `/knowledge-collections/${collectionId}/documents`,
    form,
  )
  return data.data
}

export async function createKnowledgeDocumentFile(
  collectionId: number,
  file: File,
): Promise<KnowledgeDocument> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ data: KnowledgeDocument }>(
    `/knowledge-collections/${collectionId}/documents`,
    form,
  )
  return data.data
}

export async function deleteKnowledgeDocument(
  collectionId: number,
  documentId: number,
) {
  await api.delete(
    `/knowledge-collections/${collectionId}/documents/${documentId}`,
  )
}

export async function listDocumentChunks(
  collectionId: number,
  documentId: number,
): Promise<KnowledgeChunk[]> {
  const { data } = await api.post<{ data: KnowledgeChunk[] }>(
    `/knowledge-collections/${collectionId}/documents/${documentId}/chunks`,
  )
  return data.data
}

export async function searchKnowledge(
  scope: { avatarId?: number; collectionId?: number },
  text: string,
  topK = 3,
): Promise<KnowledgeSearchResult[]> {
  const { data } = await api.post<{ data: KnowledgeSearchResult[] }>(
    '/knowledge/search',
    { ...scope, text, topK },
  )
  return data.data
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
