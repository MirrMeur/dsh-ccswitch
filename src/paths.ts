import { homedir } from 'node:os'
import * as nativePath from 'node:path'

export interface PathOperations {
  dirname(path: string): string
  join(...paths: string[]): string
}

export interface CcSwitchPaths {
  readonly database: string
  readonly providerSelection: string
  readonly codexOAuthStore: string
  readonly codexAuth: string
  readonly geminiOAuthCredentials: string
}

/** Resolve every user-level path with the host platform's path semantics. */
export function resolveCcSwitchPaths(
  home = homedir(),
  database: string | undefined = undefined,
  paths: PathOperations = nativePath,
): CcSwitchPaths {
  const resolvedDatabase = database ?? paths.join(home, '.cc-switch', 'cc-switch.db')
  return {
    database: resolvedDatabase,
    providerSelection: paths.join(home, '.dsh', 'ccswitch-providers.json'),
    codexOAuthStore: paths.join(paths.dirname(resolvedDatabase), 'codex_oauth_auth.json'),
    codexAuth: paths.join(home, '.codex', 'auth.json'),
    geminiOAuthCredentials: paths.join(home, '.gemini', 'oauth_creds.json'),
  }
}
