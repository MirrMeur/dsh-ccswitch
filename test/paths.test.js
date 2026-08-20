import assert from 'node:assert/strict'
import { posix, win32 } from 'node:path'
import test from 'node:test'
import { resolveCcSwitchPaths } from '../src/paths.ts'

test('resolves macOS and Linux paths with POSIX separators', () => {
  assert.deepEqual(
    resolveCcSwitchPaths('/home/example', '/home/example/.cc-switch/cc-switch.db', posix),
    {
      database: '/home/example/.cc-switch/cc-switch.db',
      providerSelection: '/home/example/.dsh/ccswitch-providers.json',
      codexOAuthStore: '/home/example/.cc-switch/codex_oauth_auth.json',
      codexAuth: '/home/example/.codex/auth.json',
      geminiOAuthCredentials: '/home/example/.gemini/oauth_creds.json',
    },
  )
})

test('resolves Windows drive paths with win32 separators', () => {
  assert.deepEqual(
    resolveCcSwitchPaths('C:\\Users\\Example', undefined, win32),
    {
      database: 'C:\\Users\\Example\\.cc-switch\\cc-switch.db',
      providerSelection: 'C:\\Users\\Example\\.dsh\\ccswitch-providers.json',
      codexOAuthStore: 'C:\\Users\\Example\\.cc-switch\\codex_oauth_auth.json',
      codexAuth: 'C:\\Users\\Example\\.codex\\auth.json',
      geminiOAuthCredentials: 'C:\\Users\\Example\\.gemini\\oauth_creds.json',
    },
  )

  assert.deepEqual(
    resolveCcSwitchPaths('C:\\Users\\Example', 'D:\\CC Switch Data\\cc-switch.db', win32),
    {
      database: 'D:\\CC Switch Data\\cc-switch.db',
      providerSelection: 'C:\\Users\\Example\\.dsh\\ccswitch-providers.json',
      codexOAuthStore: 'D:\\CC Switch Data\\codex_oauth_auth.json',
      codexAuth: 'C:\\Users\\Example\\.codex\\auth.json',
      geminiOAuthCredentials: 'C:\\Users\\Example\\.gemini\\oauth_creds.json',
    },
  )
})
