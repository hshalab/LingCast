import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import { useEffect, useRef } from 'react'

/** Inline xgplayer for any H.264 MP4 URL. */
export function XgVideo({ url, className }: { url: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const player = new Player({
      el: hostRef.current,
      url,
      autoplay: false,
      width: '100%',
      height: '100%',
      playbackRate: [0.75, 1, 1.25, 1.5, 2],
    })
    return () => {
      player.destroy()
    }
  }, [url])

  return <div ref={hostRef} className={className ?? 'w-full'} />
}
