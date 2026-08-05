import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { AvatarStudio } from '@/features/avatar-studio'

const avatarStudioSearchSchema = z.object({
  avatarId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/avatar-studio')({
  validateSearch: avatarStudioSearchSchema,
  component: AvatarStudioRoute,
})

function AvatarStudioRoute() {
  const { avatarId } = Route.useSearch()
  return <AvatarStudio initialAvatarId={avatarId} />
}
