'use client'

import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import FlvPlugin from 'xgplayer-flv'
import { useEffect, useRef } from 'react'

/** Live HTTP-FLV player backed by xgplayer (第三方播放器). */
export default function XgFlvPlayer({
  url,
  className,
  hideControls,
}: {
  url: string
  className?: string
  hideControls?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Mobile (<1024px) defaults to no control bar (douyin-style fullscreen);
  // pass hideControls explicitly to override.
  const noControls =
    hideControls ??
    (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)

  useEffect(() => {
    if (!hostRef.current) return
    const player = new Player({
      el: hostRef.current,
      url,
      type: 'flv',
      isLive: true,
      autoplay: true,
      playsinline: true,
      controls: !noControls,
      width: '100%',
      height: '100%',
      plugins: [FlvPlugin],
    })
    return () => {
      player.destroy()
    }
  }, [url, noControls])

  return <div ref={hostRef} className={className ?? 'w-full'} />
}
