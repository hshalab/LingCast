import { createFileRoute } from '@tanstack/react-router'
import { AvatarStudio } from '@/features/avatar-studio'

export const Route = createFileRoute('/_authenticated/avatar-studio')({
  component: AvatarStudio,
  validateSearch: (search: Record<string, unknown>) => ({
    // ?edit=<id> opens the same page in edit mode, pre-filled from the avatar.
    edit: typeof search.edit === 'string' ? search.edit : undefined,
  }),
})
