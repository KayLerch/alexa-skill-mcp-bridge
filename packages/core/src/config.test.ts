import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  applyEnvOverrides,
  loadConfigFromEnv,
  parseConfig,
  serializeConfig,
} from './config.js';

describe('parseConfig', () => {
  it('applies every default when only mcp.url is given', () => {
    const config = parseConfig({ mcp: { url: 'http://localhost:3000/mcp' } });
    expect(config.mcp.auth.type).toBe('none');
    expect(config.skill.invocationName).toBe('bridge demo');
    expect(config.skill.locales).toEqual(['en-US']);
    expect(config.agent.modelId).toBe('us.amazon.nova-2-lite-v1:0');
    expect(config.agent.reasoningEffort).toBe('off');
    expect(config.runtime).toEqual({ idleTimeoutMinutes: 20, maxLifetimeHours: 8 });
    expect(config.turn.budgetMs).toBe(6500);
    expect(config.elicitation.answerTimeoutSeconds).toBe(120);
    expect(config.speech).toEqual({ maxSentences: 3, maxChoicesSpoken: 3 });
    expect(config.memory).toEqual({ shortTerm: true, longTerm: true, hydrateLastEvents: 20 });
    expect(config.features).toEqual({
      gateway: false,
      debug: false,
      toolIntents: true,
      catchAll: true,
    });
    expect(config.aws).toEqual({ region: 'us-east-1', logRetentionDays: 7 });
    expect(config.visual).toEqual({ enabled: false, idleTimeoutMs: 60000 });
    expect(config.answers).toEqual({ choices: {} });
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

  it('accepts alexaAccountLinking without a secret name and refuses it behind the Gateway', () => {
    const ok = parseConfig({ mcp: { url: 'http://x/mcp', auth: { type: 'alexaAccountLinking' } } });
    expect(ok.mcp.auth.type).toBe('alexaAccountLinking');
    expect(() =>
      parseConfig({
        mcp: { url: 'http://x/mcp', auth: { type: 'alexaAccountLinking' } },
        features: { gateway: true },
      }),
    ).toThrowError(/features\.gateway: .*alexaAccountLinking/);
  });

  it('validates the Alexa Skill id shape', () => {
    expect(() => parseConfig({ mcp: { url: 'http://x/mcp' }, skill: { id: 'nope' } })).toThrowError(
      /skill\.id/,
    );
  });
});

describe('answers.choices (D67)', () => {
  const withChoices = (choices: unknown) =>
    parseConfig({ mcp: { url: 'http://x/mcp' }, answers: { choices } });

  it('takes canonical choices with spoken synonyms', () => {
    const config = withChoices({
      a: ['ay', 'option a', 'the first one'],
      b: ['bee', 'be'],
      "c'est": [],
    });
    expect(config.answers.choices.b).toEqual(['bee', 'be']);
  });

  it.each([
    [{ A: [] }, /answers\.choices/],
    [{ a: ['Option A'] }, /answers\.choices\.a/],
    [{ a: ['option 1'] }, /lowercase words/],
    [{ 'a.': [] }, /answers\.choices/],
    [{ a: ['  '] }, /answers\.choices\.a/],
  ])('refuses what Alexa refuses in a slot value: %j', (choices, message) => {
    expect(() => withChoices(choices)).toThrowError(message);
  });

  it('refuses a synonym that belongs to two choices or names another choice', () => {
    expect(() => withChoices({ a: ['the one'], b: ['the one'] })).toThrowError(
      /answers\.choices\.b: "the one" is already a synonym of "a"/,
    );
    expect(() => withChoices({ a: ['b'], b: [] })).toThrowError(
      /answers\.choices\.a: "b" is itself a choice/,
    );
  });
});

describe('visual.idleTimeoutMs', () => {
  it('is at least ten seconds', () => {
    const config = parseConfig({ mcp: { url: 'http://x/mcp' }, visual: { idleTimeoutMs: 90000 } });
    expect(config.visual.idleTimeoutMs).toBe(90000);
    expect(() =>
      parseConfig({ mcp: { url: 'http://x/mcp' }, visual: { idleTimeoutMs: 5000 } }),
    ).toThrowError(/visual\.idleTimeoutMs/);
    expect(() =>
      parseConfig({ mcp: { url: 'http://x/mcp' }, visual: { idleTimeoutMs: 60000.5 } }),
    ).toThrowError(/visual\.idleTimeoutMs/);
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

  it('takes the prompt addendum from its own env var (AgentCore caps a variable at 2048 characters)', () => {
    const config = parseConfig({ mcp: { url: 'http://localhost:3000/mcp' } });
    const loaded = loadConfigFromEnv({
      BRIDGE_CONFIG: serializeConfig(config),
      BRIDGE_PROMPT_ADDENDUM: JSON.stringify('Ask one question at a time.\n- Speak say.'),
    });
    expect(loaded.agent.promptAddendum).toBe('Ask one question at a time.\n- Speak say.');
  });
});

describe('applyEnvOverrides', () => {
  const file = { mcp: { url: 'http://localhost:3939/mcp', auth: { type: 'none' } } };

  it('leaves the config alone when nothing is set', () => {
    expect(applyEnvOverrides(file, {})).toEqual(file);
  });

  it('overrides only the listed fields and keeps the rest of the branch', () => {
    const merged = parseConfig(
      applyEnvOverrides(file, {
        BRIDGE_MCP_URL: 'https://mine.example.com/mcp',
        BRIDGE_MCP_AUTH_TYPE: 'bearer',
        BRIDGE_MCP_SECRET_NAME: 'bridge/token',
        BRIDGE_SKILL_ID: 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555',
        BRIDGE_AWS_REGION: 'us-west-2',
      }),
    );
    expect(merged.mcp.url).toBe('https://mine.example.com/mcp');
    expect(merged.mcp.auth).toMatchObject({ type: 'bearer', secretName: 'bridge/token' });
    expect(merged.skill.id).toBe('amzn1.ask.skill.11111111-2222-3333-4444-555555555555');
    expect(merged.aws.region).toBe('us-west-2');
    // The file object is not mutated: every consumer parses the same import.
    expect(file.mcp.url).toBe('http://localhost:3939/mcp');
  });

  it('ignores empty values and validates what it merged', () => {
    expect(parseConfig(applyEnvOverrides(file, { BRIDGE_MCP_URL: '  ' })).mcp.url).toBe(
      'http://localhost:3939/mcp',
    );
    expect(() => parseConfig(applyEnvOverrides(file, { BRIDGE_SKILL_ID: 'nope' }))).toThrowError(
      /skill\.id: must look like amzn1\.ask\.skill/,
    );
  });
});
