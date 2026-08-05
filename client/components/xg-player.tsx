'use client'

import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import FlvPlugin from 'xgplayer-flv'
import { useEffect, useRef } from 'react'

/** Live HTTP-FLV player backed by xgplayer (第三方播放器). */
export default function XgFlvPlayer({
  url,
  className,
}: {
  url: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const player = new Player({
      el: hostRef.current,
      url,
      type: 'flv',
      isLive: true,
      autoplay: true,
      width: '100%',
      height: '100%',
      plugins: [FlvPlugin],
    })
    return () => {
      player.destroy()
    }
  }, [url])

  return <div ref={hostRef} className={className ?? 'w-full'} />
}
