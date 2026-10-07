import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverRouteModels } from '../src/discovery.ts'

/** One codex route as CC Switch would describe it, including a declared size. */
const ROUTE = {
  provider: 'ccswitch/codex/ppx',
  sourceId: 'ppx',
  appType: 'codex',
  name: 'ppx',
  baseURL: 'https://relay.test',
  protocol: 'openai-responses',
  defaultModel: 'gpt-6.1-sol',
  models: [{ id: 'gpt-6.1-sol', name: 'gpt-6.1-sol', contextWindow: 1_000_000 }],
  authKind: 'api-key',
  fingerprint: 'test',
}

function stubFetch(payload, status = 200) {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return () => { globalThis.fetch = original }
}

test('a listing without size fields leaves the sizes unset', async () => {
  // Relays such as ppx report slugs and display names only. Substituting a
  // default here is what silently shrank every model to the 256K fallback.
  const restore = stubFetch({
    object: 'list',
    data: [
      { id: 'gpt-6.1-sol', object: 'model', owned_by: 'openai', display_name: 'GPT 6.1 Sol' },
      { id: 'gpt-6-astra', object: 'model', owned_by: 'openai' },
    ],
  })
  try {
    const models = await discoverRouteModels(ROUTE, { token: 'test-key' })
    assert.deepEqual(models.map(model => model.id), ['gpt-6.1-sol', 'gpt-6-astra'])
    assert.deepEqual(models.map(model => model.name), ['GPT 6.1 Sol', 'gpt-6-astra'])
    assert.deepEqual(models.map(model => model.contextWindow), [undefined, undefined])
    assert.deepEqual(models.map(model => model.maxTokens), [undefined, undefined])
  } finally {
    restore()
  }
})

test('a listing that reports sizes keeps them', async () => {
  const restore = stubFetch({
    data: [{
      id: 'gpt-6.1-sol',
      context_window: 1_000_000,
      max_output_tokens: 128_000,
    }],
  })
  try {
    const [model] = await discoverRouteModels(ROUTE, { token: 'test-key' })
    assert.equal(model.contextWindow, 1_000_000)
    assert.equal(model.maxTokens, 128_000)
  } finally {
    restore()
  }
})

test('an empty or failed listing falls back to the configured models', async () => {
  const empty = stubFetch({ data: [] })
  try {
    assert.deepEqual(
      (await discoverRouteModels(ROUTE, { token: 'test-key' })).map(model => model.id),
      ['gpt-6.1-sol'],
    )
  } finally {
    empty()
  }

  const failing = stubFetch({ error: 'nope' }, 500)
  try {
    await assert.rejects(discoverRouteModels(ROUTE, { token: 'test-key' }), /HTTP 500/)
  } finally {
    failing()
  }
})
