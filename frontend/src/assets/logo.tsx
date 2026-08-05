import { type SVGProps } from 'react'
import { cn } from '@/lib/utils'

export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      id='lingcast-logo'
      viewBox='0 0 512 512'
      xmlns='http://www.w3.org/2000/svg'
      className={cn('size-6', className)}
      {...props}
    >
      <title>灵播 LingCast</title>
      <defs>
        <linearGradient id='mainGrad' x1='0' y1='1' x2='1' y2='0'>
          <stop offset='0%' stopColor='#6C5CE7' />
          <stop offset='50%' stopColor='#4FACFE' />
          <stop offset='100%' stopColor='#00D2FF' />
        </linearGradient>
        <linearGradient id='pGrad' x1='0' y1='1' x2='1' y2='0'>
          <stop offset='0%' stopColor='#A29BFE' />
          <stop offset='100%' stopColor='#00D2FF' />
        </linearGradient>
        <filter id='glow' x='-50%' y='-50%' width='200%' height='200%'>
          <feGaussianBlur stdDeviation='8' result='blur' />
          <feMerge>
            <feMergeNode in='blur' />
            <feMergeNode in='SourceGraphic' />
          </feMerge>
        </filter>
        <filter id='glowSoft' x='-50%' y='-50%' width='200%' height='200%'>
          <feGaussianBlur stdDeviation='4' result='blur' />
          <feMerge>
            <feMergeNode in='blur' />
            <feMergeNode in='SourceGraphic' />
          </feMerge>
        </filter>
      </defs>
      <rect width='512' height='512' rx='48' fill='#0F0F1A' />
      <path
        d='M 152 115 L 152 362 Q 152 408 198 408 L 268 408'
        stroke='url(#mainGrad)'
        strokeWidth='52'
        strokeLinecap='round'
        fill='none'
      />
      <path d='M 305 328 L 305 488 L 438 408 Z' fill='url(#mainGrad)' />
      <circle cx='182' cy='72' r='14' fill='#00D2FF' opacity='0.95' filter='url(#glow)' />
      <circle cx='232' cy='48' r='9.5' fill='#A29BFE' opacity='0.75' filter='url(#glowSoft)' />
      <circle cx='276' cy='30' r='6' fill='#00D2FF' opacity='0.55' filter='url(#glowSoft)' />
      <circle cx='312' cy='18' r='3.5' fill='#A29BFE' opacity='0.35' />
      <circle cx='340' cy='12' r='2' fill='#00D2FF' opacity='0.2' />
    </svg>
  )
}
