import { AxiosError } from 'axios'
import { toast } from 'sonner'
import i18n from '@/i18n'

export function handleServerError(error: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(error)
  }

  let errMsg = i18n.t('common.somethingWentWrong')

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = i18n.t('common.noContent')
  }

  if (error instanceof AxiosError) {
    const data = error.response?.data as { title?: string; error?: string } | undefined
    const title = data?.title ?? data?.error
    if (typeof title === 'string' && title.length > 0) {
      errMsg = title
    }
  }

  toast.error(errMsg)
}
