import { createFileRoute } from '@tanstack/react-router'
import { KnowledgeDetail } from '@/features/knowledge/detail'

export const Route = createFileRoute('/_authenticated/knowledge/$id')({
  component: KnowledgeDetailRoute,
})

function KnowledgeDetailRoute() {
  const { id } = Route.useParams()
  const collectionId = Number(id)
  return <KnowledgeDetail collectionId={Number.isFinite(collectionId) ? collectionId : 0} />
}
