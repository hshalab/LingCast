import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    if (!open || !url || !hostRef.current) return
    const player = new Player({
      el: hostRef.current,
      url,
      autoplay: true,
      fluid: true,
      playbackRate: [0.75, 1, 1.25, 1.5, 2],
    })
    return () => {
      player.destroy()
    }
  }, [open, url])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{title ?? '视频预览'}</DialogTitle>
        </DialogHeader>
        <div ref={hostRef} className='w-full' />
      </DialogContent>
    </Dialog>
  )
}
