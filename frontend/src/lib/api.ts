import axios from 'axios'

export type Avatar = {
  id: number
  name: string
  imageS3Key: string
  imageS3Url: string
  voiceId: string
  baseVideoS3Key?: string
  baseVideoS3Url?: string
  status: 'initializing' | 'ready' | 'failed' | 'skipped'
  liveSettings?: LiveSettings
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

// In the dockerized setup the app and the API share the nginx origin, so the
// base URL defaults to '' (same origin, proxied via /api). For local Vite
// development set VITE_API_BASE_URL to the nginx/app origin, e.g.
// http://localhost:8080 (see frontend/.env.example).
const baseURL = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`

export const api = axios.create({ baseURL })
