import { createFileRoute } from '@tanstack/react-router'
import { KnowledgeList } from '@/features/knowledge/list'

export const Route = createFileRoute('/_authenticated/knowledge-list')({
  component: KnowledgeList,
})
