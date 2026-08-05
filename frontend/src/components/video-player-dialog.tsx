import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import { useEffect, useId, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Reusable xgplayer modal for any MP4 (H.264) preview.
 */
export function VideoPlayerDialog({
  open,
  url,
  title,
  onClose,
}: {
  open: boolean
  url?: string
  title?: string
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const playerId = useId()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open || !url) return
    setFailed(false)
    // Let the dialog finish its open animation so the container has size.
    const raf = requestAnimationFrame(() => {
      if (!hostRef.current) return
      try {
        const player = new Player({
          id: playerId,
          url,
          autoplay: true,
          fluid: true,
          playbackRate: [0.75, 1, 1.25, 1.5, 2],
        })
        player.on('error', () => setFailed(true))
        playerRef.current = player
      } catch {
        setFailed(true)
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [open, url, playerId])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{title ?? '视频预览'}</DialogTitle>
        </DialogHeader>
        {failed ? (
          <p className='py-10 text-center text-sm text-muted-foreground'>
            无法播放该视频：可能为旧版（MPEG-4）编码任务。请在任务中心删除旧任务并重新生成后重试。
          </p>
        ) : (
          <div ref={hostRef} id={playerId} className='aspect-video w-full' />
        )}
      </DialogContent>
    </Dialog>
  )
}
