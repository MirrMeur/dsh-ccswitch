import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CcSwitchRoute } from './types.ts'

export const DEFAULT_PROVIDER_SELECTION_PATH = join(homedir(), '.dsh', 'ccswitch-providers.json')

interface ProviderSelectionFile {
  readonly include?: unknown
  readonly providers?: unknown
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

function envSelectors(): readonly string[] | undefined {
  if (process.env.DSH_CCSWITCH_PROVIDERS === undefined) return undefined
  return process.env.DSH_CCSWITCH_PROVIDERS.split(',').map(item => item.trim()).filter(item => item.length > 0)
}

/** Read the user-level provider allow-list. Invalid or missing files mean no selection. */
export function readProviderSelectors(path: string): readonly string[] | undefined {
  const env = envSelectors()
  if (env !== undefined) return env
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ProviderSelectionFile | unknown
    if (Array.isArray(parsed)) return strings(parsed)
    if (parsed !== null && typeof parsed === 'object') {
      const object = parsed as ProviderSelectionFile
      return strings(object.include) ?? strings(object.providers)
    }
  } catch {
    // Missing/invalid optional selection files preserve the default all-provider behavior.
  }
  return undefined
}

function globRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function matches(route: CcSwitchRoute, selector: string): boolean {
  const values = [route.provider, route.sourceId, route.name, `${route.appType}/${route.sourceId}`]
  const regex = globRegex(selector)
  return values.some(value => regex.test(value))
}

/** Keep a route when the configured selector list names it. */
export function providerSelected(route: CcSwitchRoute, selectors: readonly string[] | undefined): boolean {
  return selectors === undefined || selectors.some(selector => matches(route, selector))
}
