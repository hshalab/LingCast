import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { adminMe } from '@/lib/api'

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
  beforeLoad: async () => {
    try {
      await adminMe()
    } catch {
      throw redirect({ to: '/login' })
    }
  },
})
