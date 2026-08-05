import { createFileRoute } from '@tanstack/react-router'
import { RoomsList } from '@/features/rooms/rooms-list'

export const Route = createFileRoute('/_authenticated/rooms/')({
  component: RoomsList,
})
