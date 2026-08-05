import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { AvatarLibrary } from '@/features/avatar-library'

const avatarLibrarySearchSchema = z.object({
  avatarId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/avatar-library')({
  validateSearch: avatarLibrarySearchSchema,
  component: AvatarLibraryRoute,
})

function AvatarLibraryRoute() {
  const { avatarId } = Route.useSearch()
  return <AvatarLibrary initialAvatarId={avatarId} />
}
