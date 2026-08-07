import type { NextRequest } from 'next/server'

/**
 * Server-side proxy for the platform API and live streams.
 *
 * The browser only talks to this app's origin (no CORS), and the upstream
 * target is read from the runtime environment on every request, so the same
 * build works for local dev (localhost:8080) and docker-compose
 * (api:8080 / srs:8080).
 */
export async function proxyRequest(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
  origin: string,
  prefix: string,
): Promise<Response> {
  const { path } = await ctx.params
  const target = `${origin}/${prefix}/${path.join('/')}${req.nextUrl.search}`

  const headers = new Headers()
  const contentType = req.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const accept = req.headers.get('accept')
  if (accept) headers.set('accept', accept)
  const authorization = req.headers.get('authorization')
  if (authorization) headers.set('authorization', authorization)
  const acceptLanguage = req.headers.get('accept-language')
  if (acceptLanguage) headers.set('accept-language', acceptLanguage)

  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : await req.arrayBuffer()

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    cache: 'no-store',
    redirect: 'follow',
  })

  const outHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    // Let the Node runtime handle the transfer encoding / content decoding.
    if (lower === 'content-encoding' || lower === 'transfer-encoding') return
    outHeaders.set(key, value)
  })
  outHeaders.set('access-control-allow-origin', '*')
  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  })
}
