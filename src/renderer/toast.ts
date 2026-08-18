// Minimal global toast: any renderer code can call toast(); <Toaster/> renders them.

export type ToastLevel = 'info' | 'error' | 'success'

export function toast(message: string, level: ToastLevel = 'info'): void {
  window.dispatchEvent(new CustomEvent('laic:toast', { detail: { message, level } }))
}
