import { createFileRoute } from '@tanstack/react-router'
import { ChatLogs } from '@/features/chats/logs'

export const Route = createFileRoute('/_authenticated/chat-logs')({
  component: ChatLogs,
})
