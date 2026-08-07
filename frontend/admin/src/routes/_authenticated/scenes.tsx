import { createFileRoute } from '@tanstack/react-router'
import { ScenesPage } from '@/features/scenes'

export const Route = createFileRoute('/_authenticated/scenes')({
  component: ScenesPage,
})
