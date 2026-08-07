import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Broadcast } from '@/features/broadcast'

const broadcastSearchSchema = z.object({
  avatarId: z.string().optional(),
  taskId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/broadcast')({
  validateSearch: broadcastSearchSchema,
  component: BroadcastRoute,
})

function BroadcastRoute() {
  const { avatarId, taskId } = Route.useSearch()
  return <Broadcast initialAvatarId={avatarId} initialTaskId={taskId} />
}
