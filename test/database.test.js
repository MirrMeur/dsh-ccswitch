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

/** Create a throwaway CC Switch database holding one codex provider row. */
function catalogRepository(settings) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ccswitch-catalog-'))
  const dataDir = join(root, 'CC Switch Data')
  const dbPath = join(dataDir, 'cc-switch.db')
  mkdirSync(dataDir)

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
  `).run('catalog-provider', 'codex', 'Catalog Provider', JSON.stringify(settings), '{}', null, 0)
  db.close()

  return {
    repository: new CcSwitchRepository({ dbPath, discoverModels: false, providerSelectors: ['*'] }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

const CODEX_CONFIG = [
  'model_provider = "custom"',
  'model = "gpt-5.5"',
  '',
  '[model_providers.custom]',
  'name = "Catalog Provider"',
  'base_url = "https://example.test"',
  'wire_api = "responses"',
].join('\n')

test('reads the per-provider Codex model catalog from settings_config', () => {
  const { repository, cleanup } = catalogRepository({
    auth: { OPENAI_API_KEY: 'test-key' },
    config: CODEX_CONFIG,
    modelCatalog: {
      models: [
        {
          model: 'gpt-6.1-sol',
          displayName: 'GPT 6.1 Sol',
          contextWindow: '1000000',
          reasoningLevels: ['none', 'high', 'ultra', 'bogus'],
          defaultReasoningLevel: 'none',
        },
        { model: 'gpt-6-sol', display_name: 'GPT 6 Sol', reasoning_levels: ['xhigh'] },
        { model: 'gpt-6.1-sol' },
        { model: '   ' },
      ],
    },
  })

  try {
    repository.read()
    const [route] = repository.current.routes
    // The TOML's default model keeps a seat ahead of the declared table, and
    // the duplicate/blank catalog rows are dropped.
    assert.deepEqual(route.models.map(model => model.id), ['gpt-5.5', 'gpt-6.1-sol', 'gpt-6-sol'])
    assert.deepEqual(route.models.map(model => model.name), ['gpt-5.5', 'GPT 6.1 Sol', 'GPT 6 Sol'])
    assert.equal(route.models[1].contextWindow, 1_000_000)
    assert.equal(route.defaultModel, 'gpt-5.5')
    // `none` becomes pi-ai's `off`; `ultra` and typos are dropped.
    assert.deepEqual(route.models[1].reasoningLevels, ['off', 'high'])
    assert.equal(route.models[1].defaultReasoningLevel, 'off')
    assert.deepEqual(route.models[2].reasoningLevels, ['xhigh'])
    assert.equal(route.models[2].defaultReasoningLevel, undefined)
    // The synthesised TOML default declares nothing, so the heuristic keeps it.
    assert.equal(route.models[0].reasoningLevels, undefined)
  } finally {
    cleanup()
  }
})

test('keeps the declared table order when it already holds the default model', () => {
  const { repository, cleanup } = catalogRepository({
    auth: { OPENAI_API_KEY: 'test-key' },
    config: CODEX_CONFIG,
    modelCatalog: {
      models: [
        { model: 'gpt-6-sol' },
        { model: 'gpt-5.5' },
      ],
    },
  })

  try {
    repository.read()
    assert.deepEqual(repository.current.routes[0].models.map(model => model.id), ['gpt-6-sol', 'gpt-5.5'])
  } finally {
    cleanup()
  }
})
