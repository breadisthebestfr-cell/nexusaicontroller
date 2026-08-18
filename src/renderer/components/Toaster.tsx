import { useEffect, useState } from 'react'
import type { ToastLevel } from '../toast'

interface Item {
  id: number
  message: string
  level: ToastLevel
}

/** Bottom-right toast stack. Auto-dismisses; click to close early. */
export function Toaster(): JSX.Element {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let n = 0
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message: string; level?: ToastLevel }
      const id = ++n
      setItems((prev) => [...prev, { id, message: detail.message, level: detail.level ?? 'info' }])
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 7000)
    }
    window.addEventListener('laic:toast', handler)
    return () => window.removeEventListener('laic:toast', handler)
  }, [])

  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
