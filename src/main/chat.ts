// Unified chat entry point used by the app: routes a `cloud:<provider>` base URL to the
// configured cloud provider (reading its key from the local store) and everything else to
// Ollama. Main-process only (it reads settings), keeping ollamaClient/providers store-free.

import { chatStream, type ChatHandlers, type ChatOptions } from './ollamaClient'
import { providerChat } from './providers'
import * as store from './store'
import type { ChatMessage } from '../shared/types'

export const CLOUD_PREFIX = 'cloud:'

export function chat(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  handlers: ChatHandlers,
  options?: ChatOptions
): Promise<void> {
  if (baseUrl.startsWith(CLOUD_PREFIX)) {
    const providerId = baseUrl.slice(CLOUD_PREFIX.length)
    const cfg = store.getSettings().cloudProviders[providerId]
    if (!cfg) {
      handlers.onError(`Unknown cloud provider: ${providerId}`)
      return Promise.resolve()
    }
    return providerChat(providerId, cfg, model, messages, handlers, options)
  }
  return chatStream(baseUrl, model, messages, handlers, options)
}
