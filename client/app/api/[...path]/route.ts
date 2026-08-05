import type { NextRequest } from 'next/server'
import { proxyRequest } from '@/lib/proxy'

// Platform API (Go + nginx): the Go API container, or host nginx in local dev.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:8080'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(req, ctx, apiOrigin, 'api')
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(req, ctx, apiOrigin, 'api')
}
