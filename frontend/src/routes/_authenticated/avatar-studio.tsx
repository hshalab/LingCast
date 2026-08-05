import { createFileRoute } from '@tanstack/react-router'
import { AvatarStudio } from '@/features/avatar-studio'

export const Route = createFileRoute('/_authenticated/avatar-studio')({
  component: AvatarStudio,
})
