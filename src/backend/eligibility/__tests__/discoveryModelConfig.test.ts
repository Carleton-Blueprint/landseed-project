import { afterEach, describe, expect, it, jest } from '@jest/globals';

type DiscoveryModelConfig = typeof import('../discoveryModelConfig');

// The model name is read at import time, so each case loads a fresh module.
function loadWithEnv(env: Record<string, string | undefined>): DiscoveryModelConfig {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  let config!: DiscoveryModelConfig;
  jest.isolateModules(() => {
    config = jest.requireActual('../discoveryModelConfig');
  });
  return config;
}

describe('grant discovery model defaults', () => {
  const original = {
    GRANT_DISCOVERY_AI_MODEL: process.env.GRANT_DISCOVERY_AI_MODEL,
    GRANT_DISCOVERY_AI_REASONING_EFFORT: process.env.GRANT_DISCOVERY_AI_REASONING_EFFORT,
  };

  afterEach(() => {
    loadWithEnv(original);
    jest.restoreAllMocks();
  });

  it('defaults to gpt-6-luna at low effort', () => {
    const config = loadWithEnv({ GRANT_DISCOVERY_AI_MODEL: undefined, GRANT_DISCOVERY_AI_REASONING_EFFORT: undefined });
    expect(config.DISCOVERY_MODEL_NAME).toBe('gpt-6-luna');
    expect(config.getDiscoveryReasoningEffort()).toBe('low');
  });

  it('sends no default effort when another model is configured', () => {
    const config = loadWithEnv({ GRANT_DISCOVERY_AI_MODEL: 'gpt-4o-mini', GRANT_DISCOVERY_AI_REASONING_EFFORT: undefined });
    expect(config.DISCOVERY_MODEL_NAME).toBe('gpt-4o-mini');
    expect(config.getDiscoveryReasoningEffort()).toBeNull();
  });

  it('uses an explicit effort on any model', () => {
    expect(
      loadWithEnv({ GRANT_DISCOVERY_AI_MODEL: undefined, GRANT_DISCOVERY_AI_REASONING_EFFORT: 'medium' }).getDiscoveryReasoningEffort()
    ).toBe('medium');
    expect(
      loadWithEnv({ GRANT_DISCOVERY_AI_MODEL: 'gpt-6.1-terra', GRANT_DISCOVERY_AI_REASONING_EFFORT: 'high' }).getDiscoveryReasoningEffort()
    ).toBe('high');
  });

  it('sends no effort (not the default) when the value is invalid', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = loadWithEnv({ GRANT_DISCOVERY_AI_MODEL: undefined, GRANT_DISCOVERY_AI_REASONING_EFFORT: 'turbo' });
    expect(config.getDiscoveryReasoningEffort()).toBeNull();
  });
});
