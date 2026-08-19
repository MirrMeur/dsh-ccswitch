import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CcSwitchCredential, CcSwitchRoute } from './types.ts'
import { CcSwitchRepository, type ProviderRecord } from './database.ts'

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
// Public OAuth client used by Gemini CLI (also used by CC Switch when it
// refreshes ~/.gemini/oauth_creds.json). It is not a user secret.
const GEMINI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const GEMINI_CLIENT_SECRET = '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'
const TOKEN_REFRESH_BUFFER_MS = 60_000
const execFileAsync = promisify(execFile)

interface CodexOAuthStore {
  readonly accounts?: Record<string, {
    readonly account_id?: string
    readonly access_token?: string
    readonly refresh_token?: string
    readonly id_token?: string
    readonly email?: string
  }>
  readonly default_account_id?: string
}

interface NativeCodexAuth {
  readonly auth_mode?: string
  readonly tokens?: {
    readonly account_id?: string
    readonly access_token?: string
    readonly refresh_token?: string
  }
}

interface GeminiOAuthCredentials {
  readonly access_token?: string
  readonly refresh_token?: string
  readonly client_id?: string
  readonly client_secret?: string
  readonly expiry_date?: number
}

interface CachedToken {
  readonly token: string
  readonly expiresAt: number
}

const cache = new Map<string, CachedToken>()

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function configValue(record: ProviderRecord, path: readonly string[]): string | undefined {
  let current: unknown = record.settings
  for (const key of path) current = objectValue(current)[key]
  return nonEmpty(current)
}

function settingValue(record: ProviderRecord, ...paths: readonly (readonly string[])[]): string | undefined {
  for (const path of paths) {
    const value = configValue(record, path)
    if (value !== undefined) return value
  }
  return undefined
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function normalizeGeminiCredentials(value: unknown): GeminiOAuthCredentials | undefined {
  if (typeof value === 'string') {
    const raw = value.trim()
    if (raw.length === 0) return undefined
    try { return normalizeGeminiCredentials(JSON.parse(raw) as unknown) } catch {
      // Gemini CLI access tokens are also accepted as a plain ya29.* value.
      return raw.startsWith('ya29.') ? { access_token: raw, expiry_date: Number.MAX_SAFE_INTEGER } : undefined
    }
  }
  if (value === null || typeof value !== 'object') return undefined
  const root = value as Record<string, unknown>
  const token = root.token !== null && typeof root.token === 'object'
    ? root.token as Record<string, unknown>
    : root
  const accessToken = nonEmpty(token.access_token) ?? nonEmpty(token.accessToken)
  const refreshToken = nonEmpty(token.refresh_token) ?? nonEmpty(token.refreshToken)
  if (accessToken === undefined && refreshToken === undefined) return undefined
  const expiry = typeof token.expiry_date === 'number'
    ? token.expiry_date
    : typeof token.expiresAt === 'number' ? token.expiresAt : undefined
  return {
    ...(accessToken === undefined ? {} : { access_token: accessToken }),
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(typeof token.client_id === 'string' ? { client_id: token.client_id } : {}),
    ...(typeof token.client_secret === 'string' ? { client_secret: token.client_secret } : {}),
    ...(expiry === undefined ? {} : { expiry_date: expiry }),
  }
}

async function readGeminiOAuthCredentials(home: string): Promise<GeminiOAuthCredentials | undefined> {
  // Gemini CLI stores the current credential in macOS Keychain when keytar is
  // available, with the file kept as a backwards-compatible fallback.
  if (process.platform === 'darwin') {
    try {
      const result = await execFileAsync('security', [
        'find-generic-password', '-s', 'gemini-cli-oauth', '-a', 'main-account', '-w',
      ], { timeout: 3_000, maxBuffer: 256 * 1024 })
      const parsed = normalizeGeminiCredentials(JSON.parse(result.stdout.trim()) as unknown)
      if (parsed !== undefined) return parsed
    } catch {
      // Missing Keychain item or a denied prompt falls back to the file.
    }
  }
  const file = await readJson<unknown>(home + '/.gemini/oauth_creds.json')
  return normalizeGeminiCredentials(file)
}

async function refreshOAuthToken(
  cacheKey: string,
  url: string,
  form: URLSearchParams,
  expiresInDefault = 3_600,
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!response.ok) throw new Error('CC Switch OAuth refresh failed (HTTP ' + response.status + ')')
  const body = await response.json() as { access_token?: string; expires_in?: number }
  const token = nonEmpty(body.access_token)
  if (token === undefined) throw new Error('CC Switch OAuth refresh returned no access token')
  const expiresAt = Date.now() + Math.max(60, body.expires_in ?? expiresInDefault) * 1_000
  cache.set(cacheKey, { token, expiresAt })
  return token
}

async function codexOAuthCredential(
  route: CcSwitchRoute,
  repository: CcSwitchRepository,
): Promise<CcSwitchCredential> {
  const dbDir = repository.config.dbPath.replace(/[/\\][^/\\]+$/, '')
  const store = await readJson<CodexOAuthStore>(dbDir + '/codex_oauth_auth.json')
  const accounts = store?.accounts ?? {}
  const native = await readJson<NativeCodexAuth>((process.env.HOME ?? process.env.USERPROFILE ?? '') + '/.codex/auth.json')
  const nativeAccountId = nonEmpty(native?.tokens?.account_id)
  const accountId = route.accountId
    ?? nonEmpty(store?.default_account_id)
    ?? Object.keys(accounts)[0]
    ?? nativeAccountId
  if (accountId === undefined) throw new Error('CC Switch Codex OAuth account is not available')
  const account = accounts[accountId]
  const nativeMatchesRoute = nativeAccountId === undefined || nativeAccountId === accountId
  const accessToken = nonEmpty(account?.access_token)
    ?? (nativeMatchesRoute ? nonEmpty(native?.tokens?.access_token) : undefined)
  const refreshToken = nonEmpty(account?.refresh_token)
    ?? (nativeMatchesRoute ? nonEmpty(native?.tokens?.refresh_token) : undefined)
  if (refreshToken === undefined && accessToken === undefined) {
    throw new Error('CC Switch Codex OAuth token is not available')
  }
  const cacheKey = 'codex:' + accountId
  const cached = cache.get(cacheKey)
  const token = cached !== undefined && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS
    ? cached.token
    : refreshToken === undefined
      ? accessToken!
      : await refreshOAuthToken(cacheKey, CODEX_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
      scope: 'openid profile email',
    }))
  return {
    token,
    headers: {
      'chatgpt-account-id': accountId,
      originator: 'cc-switch',
    },
  }
}

async function geminiOAuthCredential(route: CcSwitchRoute, repository: CcSwitchRepository, record: ProviderRecord): Promise<CcSwitchCredential> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const configured = settingValue(record, ['env', 'GEMINI_API_KEY'], ['apiKey'], ['api_key'])
  const credentials = normalizeGeminiCredentials(configured) ?? await readGeminiOAuthCredentials(home)
  if (credentials === undefined) throw new Error('CC Switch Gemini OAuth credentials are not available')
  const cacheKey = 'gemini:' + route.sourceId
  const cached = cache.get(cacheKey)
  const current = nonEmpty(credentials.access_token)
  const expiry = typeof credentials.expiry_date === 'number' ? credentials.expiry_date : 0
  const token = cached !== undefined && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS
    ? cached.token
    : current !== undefined && expiry > Date.now() + TOKEN_REFRESH_BUFFER_MS
      ? current
      : await refreshOAuthToken(cacheKey, GOOGLE_TOKEN_URL, new URLSearchParams({
        client_id: nonEmpty(credentials.client_id) ?? GEMINI_CLIENT_ID,
        client_secret: nonEmpty(credentials.client_secret) ?? GEMINI_CLIENT_SECRET,
        refresh_token: nonEmpty(credentials.refresh_token) ?? '',
        grant_type: 'refresh_token',
      }))
  return {
    token,
    headers: {
      authorization: 'Bearer ' + token,
      'x-goog-api-client': 'gemini-cli/1.0',
    },
  }
}

export async function resolveCredential(
  route: CcSwitchRoute,
  repository: CcSwitchRepository,
): Promise<CcSwitchCredential> {
  const record = repository.record(route)
  if (record === undefined) throw new Error('CC Switch provider disappeared: ' + route.sourceId)
  if (route.authKind === 'codex-oauth') return codexOAuthCredential(route, repository)
  if (route.authKind === 'gemini-oauth') return geminiOAuthCredential(route, repository, record)
  const key = route.appType === 'claude'
    ? settingValue(record, ['env', 'ANTHROPIC_AUTH_TOKEN'], ['env', 'ANTHROPIC_API_KEY'], ['apiKey'], ['api_key'])
    : route.appType === 'codex'
      ? settingValue(record, ['auth', 'OPENAI_API_KEY'], ['OPENAI_API_KEY'], ['apiKey'], ['api_key'])
      : settingValue(record, ['env', 'GEMINI_API_KEY'], ['apiKey'], ['api_key'])
  if (key === undefined) throw new Error('CC Switch provider ' + route.sourceId + ' has no usable credential')
  return { token: key }
}
