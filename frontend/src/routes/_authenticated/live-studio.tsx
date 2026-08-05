import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { LiveStudio } from '@/features/live-studio'

const liveStudioSearchSchema = z.object({
  avatarId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/live-studio')({
  validateSearch: liveStudioSearchSchema,
  component: LiveStudioRoute,
})

function LiveStudioRoute() {
  const { avatarId } = Route.useSearch()
  return <LiveStudio avatarId={avatarId ?? ''} />
}
