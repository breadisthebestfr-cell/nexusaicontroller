import { useEffect, useState } from 'react'
import type { OllamaInstance } from '../shared/types'

/** Load the current instance list and keep it in sync with main-process pushes. */
export function useInstances(): OllamaInstance[] {
  const [instances, setInstances] = useState<OllamaInstance[]>([])

  useEffect(() => {
    window.api.getInstances().then(setInstances)
    const off = window.api.onInstances(setInstances)
    return off
  }, [])

  return instances
}
