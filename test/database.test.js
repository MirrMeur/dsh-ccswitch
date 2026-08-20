import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { CcSwitchRepository } from '../src/database.ts'

test('opens a CC Switch database read-only and discovers a provider', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ccswitch-'))
  const dataDir = join(root, 'CC Switch Data')
  const dbPath = join(dataDir, 'cc-switch.db')
  mkdirSync(dataDir)

  try {
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        meta TEXT NOT NULL,
        provider_type TEXT,
        sort_index INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE provider_endpoints (
        id INTEGER PRIMARY KEY,
        provider_id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        url TEXT NOT NULL
      );
    `)
    db.prepare(`
      INSERT INTO providers (id, app_type, name, settings_config, meta, provider_type, sort_index)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'example-provider',
      'codex',
      'Example Provider',
      JSON.stringify({ OPENAI_API_KEY: 'test-key', base_url: 'https://example.test/v1' }),
      '{}',
      null,
      0,
    )
    db.close()

    const repository = new CcSwitchRepository({
      dbPath,
      discoverModels: false,
      providerSelectors: ['*'],
    })
    assert.equal(repository.exists(), true)
    assert.equal(repository.read(), true)
    assert.deepEqual(repository.current.routes.map(route => ({
      provider: route.provider,
      name: route.name,
      baseURL: route.baseURL,
    })), [{
      provider: 'ccswitch/codex/example-provider',
      name: 'Example Provider',
      baseURL: 'https://example.test/v1',
    }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
