import { createProvider } from '@earendil-works/pi-ai'
import type { Api, ApiKeyAuth, Model, Provider, ProviderStreams, ThinkingLevelMap } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { CcSwitchModel, CcSwitchRoute } from './types.ts'
import { geminiOAuthRoute } from './gemini-oauth.ts'

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const DEFAULT_CONTEXT_WINDOW = 262_144
const DEFAULT_MAX_TOKENS = 32_768
/**
 * Codex reasoning families whose level picker is enabled by name when CC
 * Switch declares no levels for them. `gpt-6*` joined the list once relays
 * began serving the family; a model with a declared level list never reaches
 * this heuristic.
 */
const CODEX_REASONING_MODEL = /^(?:gpt-[56](?:[.-]|$)|o[134](?:[.-]|$)|codex(?:[.-]|$))/i
const CODEX_THINKING_LEVELS = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: null,
  max: null,
} satisfies ThinkingLevelMap

/** Every thinking level pi-ai will offer, lowest to highest. */
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Gate pi-ai's thinking levels to the ones CC Switch declares for a model.
 *
 * `thinkingLevelMap` serves double duty: a level mapped to `null` is refused by
 * `getSupportedThinkingLevels`, while a string is both offered and sent as that
 * effort. Undeclared levels become `null` so a model that declares only
 * `xhigh` offers only `xhigh`, and `off` maps to the `none` effort CC Switch
 * and Codex use to disable thinking.
 */
function declaredThinkingLevels(levels: readonly string[]): ThinkingLevelMap {
  const declared = new Set(levels)
  const map: ThinkingLevelMap = {}
  for (const level of PI_THINKING_LEVELS) {
    map[level] = declared.has(level) ? (level === 'off' ? 'none' : level) : null
  }
  return map
}

/**
 * The thinking levels to advertise for one model. A CC Switch declaration wins;
 * otherwise codex routes fall back to the model-name heuristic, because relays
 * that predate the model table still need their reasoning families enabled.
 */
function thinkingLevelsFor(route: CcSwitchRoute, model: CcSwitchModel): ThinkingLevelMap | undefined {
  if (model.reasoningLevels !== undefined) return declaredThinkingLevels(model.reasoningLevels)
  return route.appType === 'codex' && CODEX_REASONING_MODEL.test(model.id)
    ? CODEX_THINKING_LEVELS
    : undefined
}

function routeApi(route: CcSwitchRoute): ProviderStreams {
  switch (route.protocol) {
    case 'anthropic-messages': return anthropicMessagesApi()
    case 'openai-completions': return openAICompletionsApi()
    case 'openai-responses': return openAIResponsesApi()
    case 'google-generative-ai': return googleGenerativeAIApi()
  }
}

/**
 * Resolve the model table pi-ai sees.
 *
 * A size resolves in three steps: the model's own declaration, then the route
 * default (Codex's `model_context_window`), then the built-in fallback. Without
 * the middle step a relay that reports no sizes left every model at 256K while
 * the user's own Codex config said 1M.
 */
function routeModels(route: CcSwitchRoute): readonly Model<Api>[] {
  return route.models.map((model) => {
    const thinkingLevelMap = thinkingLevelsFor(route, model)
    return {
      id: model.id,
      name: model.name,
      api: route.protocol,
      provider: route.provider,
      baseUrl: route.baseURL,
      reasoning: thinkingLevelMap !== undefined,
      ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
      input: ['text', 'image'],
      cost: NO_COST,
      contextWindow: model.contextWindow ?? route.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: model.maxTokens ?? route.maxTokens ?? DEFAULT_MAX_TOKENS,
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
