import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Knowledge } from '@/features/knowledge'

const knowledgeSearchSchema = z.object({
  avatarId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/knowledge/')({
  validateSearch: knowledgeSearchSchema,
  component: KnowledgeRoute,
})

function KnowledgeRoute() {
  const { avatarId } = Route.useSearch()
  return <Knowledge initialAvatarId={avatarId} />
}
