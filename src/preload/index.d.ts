import type { LocalAIApi } from './index'

declare global {
  interface Window {
    api: LocalAIApi
  }
}

export {}
