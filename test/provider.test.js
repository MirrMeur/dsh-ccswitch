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
