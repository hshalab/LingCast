import { createFileRoute } from '@tanstack/react-router'
import { SceneVideoAddPage } from '@/features/scenes/video-add'

export const Route = createFileRoute('/_authenticated/scenes/add-video')({
  component: SceneVideoAddPage,
  validateSearch: (search: Record<string, unknown>) => ({
    sceneId: Number(search.sceneId ?? 0),
    avatarId: Number(search.avatarId ?? 0),
  }),
})
