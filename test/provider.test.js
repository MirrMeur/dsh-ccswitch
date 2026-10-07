import assert from 'node:assert/strict'
import test from 'node:test'
import { CcSwitchAdapter } from '../src/adapter.ts'
import { modelForRoute } from '../src/provider.ts'

function route(appType, modelId) {
  return {
    provider: `ccswitch/${appType}/test`,
    sourceId: 'test',
    appType,
    name: 'Test',
    baseURL: 'https://example.test/v1',
    protocol: appType === 'claude' ? 'anthropic-messages'
      : appType === 'gemini' ? 'google-generative-ai' : 'openai-responses',
    defaultModel: modelId,
    models: [{ id: modelId, name: modelId, contextWindow: 128_000, maxTokens: 8_192 }],
    authKind: 'api-key',
    fingerprint: 'test',
  }
}

test('declares image input for Claude, Codex, and Gemini routes', () => {
  for (const appType of ['claude', 'codex', 'gemini']) {
    const model = modelForRoute(route(appType, appType === 'codex' ? 'gpt-4.1' : `${appType}-model`), appType === 'codex' ? 'gpt-4.1' : `${appType}-model`)
    assert.deepEqual(model?.input, ['text', 'image'])
  }
})

test('enables verified reasoning levels only for reasoning-capable Codex model families', () => {
  const reasoning = modelForRoute(route('codex', 'gpt-5.6-sol'), 'gpt-5.6-sol')
  assert.equal(reasoning?.reasoning, true)
  assert.deepEqual(reasoning?.thinkingLevelMap, {
    off: null,
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: null,
    max: null,
  })

  assert.equal(modelForRoute(route('codex', 'gpt-4.1'), 'gpt-4.1')?.reasoning, false)
  assert.equal(modelForRoute(route('claude', 'claude-sonnet-4-5'), 'claude-sonnet-4-5')?.reasoning, false)
})

test('publishes the configured Codex reasoning default to DSH', async () => {
  const codex = route('codex', 'gpt-5.6-sol')
  const repository = {
    current: { version: 1, fingerprint: 'test', routes: [codex] },
    config: { codexReasoningEffort: 'minimal' },
  }
  const adapter = new CcSwitchAdapter(repository)

  const resolved = await adapter.resolveModel(codex.provider, codex.defaultModel)
  assert.deepEqual(resolved.reasoning, {
    efforts: [
      { id: 'minimal', name: 'Minimal' },
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
    ],
    defaultEffort: 'minimal',
  })
})

/** One codex route carrying an explicit CC Switch model table. */
function declaredRoute(models) {
  return {
    ...route('codex', models[0].id),
    defaultModel: models[0].id,
    models,
  }
}

test('a declared model table overrides the reasoning name heuristic', () => {
  // `relay-custom` matches no branch of CODEX_REASONING_MODEL, so without a
  // declaration it advertises no reasoning at all.
  assert.equal(modelForRoute(route('codex', 'relay-custom'), 'relay-custom')?.reasoning, false)
  // The `gpt-6*` family is covered by the heuristic, declaration or not.
  assert.equal(modelForRoute(route('codex', 'gpt-6-sol'), 'gpt-6-sol')?.reasoning, true)

  const xhighOnly = declaredRoute([
    { id: 'gpt-6-sol', name: 'gpt-6-sol', contextWindow: 128_000, maxTokens: 8_192, reasoningLevels: ['xhigh'] },
  ])
  const model = modelForRoute(xhighOnly, 'gpt-6-sol')
  assert.equal(model?.reasoning, true)
  // Undeclared levels are refused, so only `xhigh` survives the support gate.
  assert.deepEqual(model?.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: 'xhigh',
    max: null,
  })

  const withOff = declaredRoute([
    { id: 'gpt-6.1-sol', name: 'gpt-6.1-sol', contextWindow: 128_000, maxTokens: 8_192, reasoningLevels: ['off', 'high'] },
  ])
  assert.deepEqual(modelForRoute(withOff, 'gpt-6.1-sol')?.thinkingLevelMap, {
    off: 'none',
    minimal: null,
    low: null,
    medium: null,
    high: 'high',
    xhigh: null,
    max: null,
  })
})

test('falls back to a model-declared default when the runtime default is unsupported', async () => {
  const codex = declaredRoute([
    {
      id: 'gpt-6-sol',
      name: 'gpt-6-sol',
      contextWindow: 128_000,
      maxTokens: 8_192,
      reasoningLevels: ['xhigh'],
      defaultReasoningLevel: 'xhigh',
    },
  ])
  const repository = {
    current: { version: 1, fingerprint: 'test', routes: [codex] },
    config: { codexReasoningEffort: 'minimal' },
  }
  const adapter = new CcSwitchAdapter(repository)

  const resolved = await adapter.resolveModel(codex.provider, 'gpt-6-sol')
  assert.deepEqual(resolved.reasoning, {
    efforts: [{ id: 'xhigh', name: 'Xhigh' }],
    defaultEffort: 'xhigh',
  })
})

test('endpoint discovery keeps the thinking levels CC Switch declared', async () => {
  // An endpoint reports slugs and sizes only, so a discovery pass used to strip
  // the declared levels and leave `gpt-6-sol` — a name the heuristic does not
  // recognise — with no level picker at all.
  const codex = declaredRoute([
    {
      id: 'gpt-6-sol',
      name: 'gpt-6-sol',
      contextWindow: 128_000,
      maxTokens: 8_192,
      reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningLevel: 'high',
    },
  ])
  const repository = {
    current: { version: 1, fingerprint: 'test', routes: [codex] },
    config: { codexReasoningEffort: 'minimal' },
  }
  const adapter = new CcSwitchAdapter(repository)

  adapter.setDiscoveredModels(codex.provider, [
    { id: 'gpt-6-sol', name: 'gpt-6-sol', contextWindow: 1_000_000, maxTokens: 128_000 },
    { id: 'gpt-6-astra', name: 'gpt-6-astra', contextWindow: 1_000_000, maxTokens: 128_000 },
  ])

  const declared = await adapter.resolveModel(codex.provider, 'gpt-6-sol')
  assert.deepEqual(declared.reasoning?.efforts.map(effort => effort.id), [
    'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
  ])
  // The runtime-wide default still wins while the model supports it.
  assert.equal(declared.reasoning?.defaultEffort, 'minimal')
  // The endpoint's own size still wins, and an undeclared model falls back to
  // the family heuristic rather than advertising nothing at all.
  assert.equal(declared.context.contextWindow, 1_000_000)
  const heuristic = await adapter.resolveModel(codex.provider, 'gpt-6-astra')
  assert.deepEqual(heuristic.reasoning?.efforts.map(effort => effort.id), [
    'minimal', 'low', 'medium', 'high',
  ])

  // A model that cannot honour the runtime default answers with its own.
  const narrowed = new CcSwitchAdapter({
    current: {
      version: 1,
      fingerprint: 'test',
      routes: [declaredRoute([{
        id: 'gpt-6-sol',
        name: 'gpt-6-sol',
        contextWindow: 128_000,
        maxTokens: 8_192,
        reasoningLevels: ['xhigh'],
        defaultReasoningLevel: 'xhigh',
      }])],
    },
    config: { codexReasoningEffort: 'minimal' },
  })
  narrowed.setDiscoveredModels('ccswitch/codex/test', [
    { id: 'gpt-6-sol', name: 'gpt-6-sol', contextWindow: 1_000_000, maxTokens: 128_000 },
  ])
  assert.equal((await narrowed.resolveModel('ccswitch/codex/test', 'gpt-6-sol')).reasoning?.defaultEffort, 'xhigh')
})

test('a route context window covers models that declare no size', () => {
  const codex = {
    ...route('codex', 'gpt-6-sol'),
    contextWindow: 1_000_000,
    models: [{ id: 'gpt-6-sol', name: 'gpt-6-sol' }],
  }
  const model = modelForRoute(codex, 'gpt-6-sol')
  assert.equal(model?.contextWindow, 1_000_000)
  // The route carries no output cap, so the built-in fallback still applies.
  assert.equal(model?.maxTokens, 32_768)

  // A model that declares its own size outranks the route default.
  const declared = {
    ...codex,
    models: [{ id: 'gpt-6-sol', name: 'gpt-6-sol', contextWindow: 200_000, maxTokens: 16_384 }],
  }
  assert.equal(modelForRoute(declared, 'gpt-6-sol')?.contextWindow, 200_000)
  assert.equal(modelForRoute(declared, 'gpt-6-sol')?.maxTokens, 16_384)

  // With neither, the built-in 256K fallback keeps its old meaning.
  const bare = { ...route('codex', 'gpt-6-sol'), models: [{ id: 'gpt-6-sol', name: 'gpt-6-sol' }] }
  assert.equal(modelForRoute(bare, 'gpt-6-sol')?.contextWindow, 262_144)
  assert.equal(modelForRoute(bare, 'gpt-6-sol')?.maxTokens, 32_768)
})

test('an endpoint that reports no sizes does not shrink a declared model', async () => {
  // A relay whose `/models` returns slugs only used to reset every model to the
  // 256K fallback, which made a 1M-token session fail its own compaction.
  const codex = {
    ...declaredRoute([{
      id: 'gpt-6-sol',
      name: 'gpt-6-sol',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      reasoningLevels: ['minimal', 'high'],
    }]),
    contextWindow: 1_000_000,
  }
  const repository = {
    current: { version: 1, fingerprint: 'test', routes: [codex] },
    config: { codexReasoningEffort: 'minimal' },
  }
  const adapter = new CcSwitchAdapter(repository)

  adapter.setDiscoveredModels(codex.provider, [
    { id: 'gpt-6-sol', name: 'gpt-6-sol' },
    { id: 'gpt-6-astra', name: 'gpt-6-astra' },
  ])

  // The declared size survives the slug-only listing.
  assert.equal((await adapter.resolveModel(codex.provider, 'gpt-6-sol')).context.contextWindow, 1_000_000)
  // A model CC Switch never declared inherits the route default instead.
  assert.equal((await adapter.resolveModel(codex.provider, 'gpt-6-astra')).context.contextWindow, 1_000_000)
  // A reported size is still trusted over both.
  adapter.setDiscoveredModels(codex.provider, [
    { id: 'gpt-6-sol', name: 'gpt-6-sol', contextWindow: 400_000 },
  ])
  assert.equal((await adapter.resolveModel(codex.provider, 'gpt-6-sol')).context.contextWindow, 400_000)
})
