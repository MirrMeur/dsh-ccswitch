import { createProvider } from '@earendil-works/pi-ai'
import type { Api, ApiKeyAuth, Model, Provider, ProviderStreams, ThinkingLevelMap } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { CcSwitchRoute } from './types.ts'
import { geminiOAuthRoute } from './gemini-oauth.ts'

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const CODEX_REASONING_MODEL = /^(?:gpt-5(?:[.-]|$)|o[134](?:[.-]|$)|codex(?:[.-]|$))/i
const CODEX_THINKING_LEVELS = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: null,
  max: null,
} satisfies ThinkingLevelMap

function routeApi(route: CcSwitchRoute): ProviderStreams {
  switch (route.protocol) {
    case 'anthropic-messages': return anthropicMessagesApi()
    case 'openai-completions': return openAICompletionsApi()
    case 'openai-responses': return openAIResponsesApi()
    case 'google-generative-ai': return googleGenerativeAIApi()
  }
}

function routeModels(route: CcSwitchRoute): readonly Model<Api>[] {
  return route.models.map((model) => {
    const reasoning = route.appType === 'codex' && CODEX_REASONING_MODEL.test(model.id)
    return {
      id: model.id,
      name: model.name,
      api: route.protocol,
      provider: route.provider,
      baseUrl: route.baseURL,
      reasoning,
      ...(reasoning ? { thinkingLevelMap: CODEX_THINKING_LEVELS } : {}),
      input: ['text', 'image'],
      cost: NO_COST,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }
  })
}

/**
 * A provider auth method is intentionally only a transport hook. The adapter
 * passes a freshly resolved CC Switch credential through `apiKey` for every
 * request, while this resolver keeps pi-ai's Models collection stateless.
 */
export function ccswitchApiKeyAuth(): ApiKeyAuth {
  return {
    name: 'CC Switch',
    resolve: ({ credential }) => Promise.resolve({
      auth: credential?.key === undefined ? {} : { apiKey: credential.key },
      source: 'CC Switch',
    }),
  }
}

export function buildProvider(route: CcSwitchRoute): Provider {
  const oauthApi = geminiOAuthRoute(route)
  return createProvider({
    id: route.provider,
    name: route.name,
    baseUrl: route.baseURL,
    auth: { apiKey: ccswitchApiKeyAuth() },
    models: routeModels(route),
    api: oauthApi ?? routeApi(route),
  })
}

export function modelForRoute(route: CcSwitchRoute, modelId: string): Model<Api> | undefined {
  return routeModels(route).find(model => model.id === modelId)
}
