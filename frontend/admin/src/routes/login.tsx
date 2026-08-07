import { createFileRoute } from '@tanstack/react-router'
import { AdminLogin } from '@/features/auth/login'

export const Route = createFileRoute('/login')({
  component: AdminLogin,
})
