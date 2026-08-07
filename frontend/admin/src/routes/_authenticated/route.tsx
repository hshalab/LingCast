import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { adminMe } from '@/lib/api'

// Session check is cached after the first successful verification: entering
// the admin console (or navigating between its pages) must not re-request
// /api/admin/me on every route change. Expired sessions are caught by the
// global 401 interceptor in lib/api.ts instead.
let sessionValid = false
let sessionCheck: Promise<boolean> | null = null

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
  beforeLoad: async () => {
    if (sessionValid) return
    if (!sessionCheck) {
      sessionCheck = adminMe()
        .then(() => {
          sessionValid = true
          return true
        })
        .catch(() => false)
        .finally(() => {
          sessionCheck = null
        })
    }
    const ok = await sessionCheck
    if (!ok) throw redirect({ to: '/login' })
  },
})
