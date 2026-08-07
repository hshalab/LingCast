// TaskProgress is a compact inline progress bar (thin track + percentage)
// used by the task center and broadcast history for processing tasks.
export function TaskProgress({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className='flex min-w-[168px] items-center gap-2'>
      {label && (
        <span className='shrink-0 text-xs text-muted-foreground'>{label}</span>
      )}
      <div
        role='progressbar'
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        className='h-1.5 w-16 overflow-hidden rounded-full bg-muted'
      >
        <div
          className='h-full rounded-full bg-primary transition-all'
          style={{ width: `${v}%` }}
        />
      </div>
      <span className='w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
        {v}%
      </span>
    </div>
  )
}
