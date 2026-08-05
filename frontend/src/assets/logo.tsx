import { useTheme } from '@/context/theme-provider'
import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme()
  const src = resolvedTheme === 'dark' ? '/images/logo-white.svg' : '/images/logo.svg'
  return (
    <img
      src={src}
      alt='灵播 LingCast'
      className={cn('size-6 rounded-md object-cover', className)}
    />
  )
}
