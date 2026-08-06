// Layout route for the knowledge base pages: /knowledge (collection list,
// see knowledge/index.tsx) and /knowledge/$id (collection detail). The
// layout itself renders nothing — each page carries its own header.
import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/knowledge')({
  component: () => <Outlet />,
})
