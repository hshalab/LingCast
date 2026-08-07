import type { NextRequest } from 'next/server'
import { proxyRequest } from '@/lib/proxy'

// HTTP-FLV live gateway: SRS container in docker-compose, host nginx in local
// dev (both publish the stream under /live/<stream>.flv).
const liveOrigin = process.env.LIVE_ORIGIN ?? 'http://localhost:8080'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(req, ctx, liveOrigin, 'live')
}
