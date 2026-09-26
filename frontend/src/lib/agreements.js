import api from './api'

export const agreementStatus = {
  pending: 'Awaiting customer', awaiting_shop: 'Awaiting shop signature', signed: 'Signed', voided: 'Voided',
}
export const agreementInput = 'w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none'
export const agreementButton = 'rounded-lg border border-line-2 px-3 py-2 text-sm text-ink hover:border-brand disabled:opacity-50'
export async function downloadAgreement(path, filename) {
  const { data } = await api.get(path, { responseType: 'blob' })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function agreementError(error) {
  return typeof error?.response?.data?.error === 'string' ? error.response.data.error : 'Could not complete this agreement action. Please try again.'
}
