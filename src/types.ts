import type { Api } from '@earendil-works/pi-ai'

export type CcSwitchAppType = 'claude' | 'codex' | 'gemini'

export type CcSwitchProtocol =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses'
  | 'google-generative-ai'

export type CcSwitchAuthKind = 'api-key' | 'claude-token' | 'codex-oauth' | 'gemini-oauth'

export type CcSwitchReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export interface CcSwitchRoute {
  readonly provider: string
  readonly sourceId: string
  readonly appType: CcSwitchAppType
  readonly name: string
  readonly baseURL: string
  readonly protocol: CcSwitchProtocol
  readonly defaultModel: string
  readonly models: readonly CcSwitchModel[]
  /**
   * Route-wide context size, taken from the provider TOML's
   * `model_context_window`. It seeds every model of the route that does not
   * declare a size of its own, including models a later endpoint discovery
   * adds. Absent means the built-in fallback applies.
   */
  readonly contextWindow?: number
  /** Route-wide output cap for models that do not declare their own. */
  readonly maxTokens?: number
  readonly authKind: CcSwitchAuthKind
  readonly accountId?: string
  readonly fingerprint: string
}

export interface CcSwitchModel {
  readonly id: string
  readonly name: string
  /**
   * Context window in tokens. Absent when neither CC Switch nor the endpoint
   * listing reported one, in which case the route default and finally the
   * built-in fallback apply. Sized models carry their own value.
   */
  readonly contextWindow?: number
  /** Output cap in tokens. Absent means the route default, then the fallback. */
  readonly maxTokens?: number
  /**
   * Thinking levels CC Switch declares for this model, already canonicalized to
   * pi-ai's vocabulary (`none` becomes `off`, `ultra` and typos are dropped).
   * Absent means the provider declared none, so callers fall back to their own
   * heuristic.
   */
  readonly reasoningLevels?: readonly string[]
  /** The model's declared default thinking level, canonicalized the same way. */
  readonly defaultReasoningLevel?: string
}

export interface CcSwitchCredential {
  readonly token?: string
  readonly headers?: Readonly<Record<string, string>>
}

export interface CcSwitchSnapshot {
  readonly version: number
  readonly fingerprint: string
  readonly routes: readonly CcSwitchRoute[]
}

export interface CcSwitchConfig {
  readonly dbPath: string
  readonly pollIntervalMs: number
  readonly appTypes: readonly CcSwitchAppType[]
  readonly discoverModels: boolean
  /** Optional provider allow-list. Undefined means all discovered providers. */
  readonly providerSelectors?: readonly string[]
  /** User-level JSON allow-list path used when the environment override is absent. */
  readonly providerSelectionPath: string
  /** Default effort for reasoning-capable Codex models; absent preserves the upstream default. */
  readonly codexReasoningEffort?: CcSwitchReasoningEffort
}

export type CcSwitchPiApi = Api
