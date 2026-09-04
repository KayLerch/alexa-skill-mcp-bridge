import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfigFromEnv, parseConfig, serializeConfig } from './config.js';

describe('parseConfig', () => {
  it('applies every default when only mcp.url is given', () => {
    const config = parseConfig({ mcp: { url: 'http://localhost:3000/mcp' } });
    expect(config.mcp.auth.type).toBe('none');
    expect(config.mcp.protocolVersion).toBe('2025-11-25');
    expect(config.skill.invocationName).toBe('my bridge');
    expect(config.skill.locales).toEqual(['en-US']);
    expect(config.agent.modelId).toBe('us.amazon.nova-2-lite-v1:0');
    expect(config.agent.reasoningEffort).toBe('off');
    expect(config.runtime).toEqual({ idleTimeoutMinutes: 20, maxLifetimeHours: 8 });
    expect(config.turn.budgetMs).toBe(6500);
    expect(config.elicitation.answerTimeoutSeconds).toBe(120);
    expect(config.memory).toEqual({ shortTerm: true, longTerm: true, hydrateLastEvents: 20 });
    expect(config.features).toEqual({ gateway: false, debug: false });
    expect(config.aws).toEqual({ region: 'us-east-1', budgetUsd: 5, logRetentionDays: 7 });
  });

  it('fails on a missing mcp.url with the field path and the fix', () => {
    expect(() => parseConfig({ mcp: {} })).toThrowError(ConfigError);
    expect(() => parseConfig({ mcp: {} })).toThrowError(/mcp\.url: .*Streamable HTTP endpoint/);
  });

  it('requires a secret name for any auth other than none', () => {
    expect(() =>
      parseConfig({ mcp: { url: 'http://x/mcp', auth: { type: 'bearer' } } }),
    ).toThrowError(/mcp\.auth\.secretName: required when auth\.type is 'bearer'/);
    const ok = parseConfig({
      mcp: { url: 'http://x/mcp', auth: { type: 'bearer', secretName: 's' } },
    });
    expect(ok.mcp.auth.secretName).toBe('s');
  });

  it('refuses protocol versions older than 2025-11-25', () => {
    expect(() =>
      parseConfig({ mcp: { url: 'http://x/mcp', protocolVersion: '2025-06-18' } }),
    ).toThrowError(/mcp\.protocolVersion: must be 2025-11-25 or later/);
  });

  it('validates the skill id shape', () => {
    expect(() => parseConfig({ mcp: { url: 'http://x/mcp' }, skill: { id: 'nope' } })).toThrowError(
      /skill\.id/,
    );
  });
});

describe('env round trip', () => {
  it('serializes and loads back identically', () => {
    const config = parseConfig({ mcp: { url: 'http://x/mcp' }, features: { debug: true } });
    const loaded = loadConfigFromEnv({ BRIDGE_CONFIG: serializeConfig(config) });
    expect(loaded).toEqual(config);
  });

  it('explains a missing env var', () => {
    expect(() => loadConfigFromEnv({})).toThrowError(/BRIDGE_CONFIG is not set/);
  });
});
