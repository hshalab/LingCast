import { createFileRoute } from '@tanstack/react-router'
import { AvatarLibrary } from '@/features/avatar-library'

export const Route = createFileRoute('/_authenticated/avatar-library')({
  component: AvatarLibrary,
})
