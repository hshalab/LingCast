import { createFileRoute } from '@tanstack/react-router'
import { TaskCenter } from '@/features/task-center'

export const Route = createFileRoute('/_authenticated/task-center')({
  component: TaskCenter,
})
