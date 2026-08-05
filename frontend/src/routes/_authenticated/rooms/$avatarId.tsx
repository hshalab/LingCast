import { createFileRoute } from '@tanstack/react-router'
import { Room } from '@/features/rooms/room'

export const Route = createFileRoute('/_authenticated/rooms/$avatarId')({
  component: RoomRoute,
})

function RoomRoute() {
  const { avatarId } = Route.useParams()
  return <Room avatarId={avatarId} />
}
