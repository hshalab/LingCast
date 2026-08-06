'use client'

import { useI18n } from '@/lib/i18n'

export default function ConfirmDialog({
  open,
  title,
  desc,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  desc: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  if (!open) return null
  return (
    <div
      className='fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4'
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className='w-full max-w-xs rounded-2xl border border-border bg-surface p-5 shadow-2xl'
      >
        <h3 className='font-semibold text-foreground'>{title}</h3>
        <p className='mt-1.5 text-sm leading-relaxed text-muted'>{desc}</p>
        <div className='mt-4 flex justify-end gap-2'>
          <button
            onClick={onClose}
            disabled={busy}
            className='rounded-lg border border-border px-3.5 py-1.5 text-sm text-subtle transition hover:border-foreground/50 disabled:opacity-40'
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className='rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-40'
          >
            {busy ? t('common.processing') : t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
