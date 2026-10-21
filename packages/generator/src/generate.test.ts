import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startHotelsWeatherServer,
  type HotelsWeatherServerHandle,
} from '@alexa-mcp-bridge/hotels-weather-mcp-server';
import { parseConfig, toolManifestSchema } from '@alexa-mcp-bridge/core';
import { generate, examplePhrase } from './generate.js';
import { scanServer, ScanError } from './scan.js';
import { combineOverrides } from './utterances/overrides.js';

let server: HotelsWeatherServerHandle;
let dir: string;

beforeAll(async () => {
  server = await startHotelsWeatherServer({ port: 0, log: () => undefined });
  dir = mkdtempSync(join(tmpdir(), 'bridge-gen-'));
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const paths = () => ({
  manifest: join(dir, 'generated/tool-manifest.json'),
  interactionModelDir: join(dir, 'interactionModels/custom'),
  overridesDir: join(dir, 'overrides'),
  trainingDir: join(dir, 'training'),
});

describe('scanServer', () => {
  it('reads server info, version, and tools', async () => {
    const scan = await scanServer(parseConfig({ mcp: { url: server.url } }));
    expect(scan.server.name).toBe('hotels-and-weather');
    expect(scan.server.instructions).toMatch(/hotels/);
    expect(scan.protocolVersion).toBe('2025-11-25');
    expect(scan.tools.map((t) => t.name)).toEqual(['search_hotels', 'get_weather']);
  });

  it('explains an unreachable server', async () => {
    await expect(
      scanServer(parseConfig({ mcp: { url: 'http://127.0.0.1:9/mcp' } })),
    ).rejects.toThrow(ScanError);
    await expect(
      scanServer(parseConfig({ mcp: { url: 'http://127.0.0.1:9/mcp' } })),
    ).rejects.toThrow(/Cannot reach/);
  });
});

describe('generate (template utterances)', () => {
  it('writes a valid manifest and interaction model for the sample server', async () => {
    const config = parseConfig({
      mcp: { url: server.url },
      skill: { invocationName: 'hotel helper' },
    });
    const result = await generate({ config, paths: paths(), useModel: false });

    const manifest = toolManifestSchema.parse(JSON.parse(readFileSync(paths().manifest, 'utf8')));
    expect(manifest._generated.by).toMatch(/generator/);
    expect(manifest.tools.map((t) => t.intent)).toEqual(['SearchHotelsIntent', 'GetWeatherIntent']);
    expect(manifest.examplePhrases).toHaveLength(2);

    const model = result.models['en-US'];
    expect(model?.interactionModel.languageModel.invocationName).toBe('hotel helper');
    const intents = model?.interactionModel.languageModel.intents.map((i) => i.name) ?? [];
    expect(intents).toEqual(
      expect.arrayContaining([
        'SearchHotelsIntent',
        'GetWeatherIntent',
        'AMAZON.YesIntent',
        'AMAZON.NoIntent',
        'DateAnswerIntent',
        'NumberAnswerIntent',
        'FreeTextAnswerIntent',
        'FreeTextIntent',
        'AMAZON.HelpIntent',
        'AMAZON.StopIntent',
        'AMAZON.CancelIntent',
        'AMAZON.FallbackIntent',
      ]),
    );
    const hotels = model?.interactionModel.languageModel.intents.find(
      (i) => i.name === 'SearchHotelsIntent',
    );
    expect(hotels?.slots).toEqual([
      { name: 'checkIn', type: 'AMAZON.DATE' },
      { name: 'checkOut', type: 'AMAZON.DATE' },
      { name: 'guests', type: 'AMAZON.NUMBER' },
      { name: 'destination', type: 'AMAZON.SearchQuery' },
    ]);
    expect(hotels?.samples?.length).toBeGreaterThanOrEqual(8);
    expect(result.notes).toEqual([]);
  });

  it('is deterministic across runs', async () => {
    const config = parseConfig({ mcp: { url: server.url } });
    await generate({ config, paths: paths(), useModel: false });
    const first = readFileSync(join(paths().interactionModelDir, 'en-US.json'), 'utf8');
    const firstManifest = readFileSync(paths().manifest, 'utf8');
    await generate({ config, paths: paths(), useModel: false });
    expect(readFileSync(join(paths().interactionModelDir, 'en-US.json'), 'utf8')).toBe(first);
    expect(readFileSync(paths().manifest, 'utf8')).toBe(firstManifest);
  });

  it('merges overrides and reports rejected ones', async () => {
    const config = parseConfig({ mcp: { url: server.url } });
    mkdirSync(paths().overridesDir, { recursive: true });
    writeFileSync(
      join(paths().overridesDir, 'en-US.utterances.json'),
      JSON.stringify({
        SearchHotelsIntent: [
          'find me a place to stay in {destination}',
          'hotels in {destination} for {guests}',
        ],
        NopeIntent: ['x'],
      }),
    );
    const result = await generate({ config, paths: paths(), useModel: false });
    const samples = result.models['en-US']?.interactionModel.languageModel.intents.find(
      (i) => i.name === 'SearchHotelsIntent',
    )?.samples;
    expect(samples?.[0]).toBe('find me a place to stay in {destination}');
    expect(result.notes).toEqual([
      expect.stringMatching(/rejected: "hotels in \{destination\} for \{guests\}"/),
      expect.stringMatching(/unknown intent NopeIntent/),
    ]);
    rmSync(paths().overridesDir, { recursive: true, force: true });
  });

  it('merges a profile folder overrides after the repo ones (D56)', async () => {
    const config = parseConfig({ mcp: { url: server.url } });
    const profileOverrides = join(dir, 'profile/overrides');
    mkdirSync(profileOverrides, { recursive: true });
    writeFileSync(
      join(profileOverrides, 'en-US.utterances.json'),
      JSON.stringify({
        intents: [
          {
            name: 'WhereToStayIntent',
            tool: 'search_hotels',
            samples: ['where should i stay in {destination}'],
          },
        ],
      }),
    );
    const withProfile = await generate({
      config,
      paths: { ...paths(), profileOverridesDir: profileOverrides },
      useModel: false,
    });
    const intents = (r: typeof withProfile) =>
      r.models['en-US']?.interactionModel.languageModel.intents.map((i) => i.name) ?? [];
    expect(intents(withProfile)).toContain('WhereToStayIntent');
    const without = await generate({ config, paths: paths(), useModel: false });
    expect(intents(without)).not.toContain('WhereToStayIntent');
    rmSync(join(dir, 'profile'), { recursive: true, force: true });
  });

  it('matches the snapshot for the hotels and weather server', async () => {
    const config = parseConfig({ mcp: { url: server.url } });
    const result = await generate({ config, paths: paths(), useModel: false });
    expect(result.manifest).toMatchSnapshot();
    expect(result.models['en-US']).toMatchSnapshot();
  });
});

describe('direct calls (D57, D59)', () => {
  it('notes a launch or built-in tool the server does not list', async () => {
    const config = parseConfig({
      mcp: { url: server.url },
      skill: { launch: { tool: 'suggest_trip' } },
      intents: {
        builtIns: {
          'AMAZON.NextIntent': { tool: 'get_weather' },
          'AMAZON.StopIntent': { tool: 'end_trip' },
        },
      },
    });
    const result = await generate({ config, paths: paths(), useModel: false });
    expect(result.notes).toContain(
      'skill.launch names the tool suggest_trip, which the server does not list',
    );
    expect(result.notes).toContain(
      'intents.builtIns.AMAZON.StopIntent names the tool end_trip, which the server does not list',
    );
    expect(result.notes.join('\n')).not.toContain('get_weather');
  });
});

describe('examplePhrase', () => {
  it('fills slots with spoken placeholders', () => {
    const phrase = examplePhrase(
      {
        name: 'search_hotels',
        intent: 'SearchHotelsIntent',
        slots: [
          { argument: 'guests', slot: 'guests', slotType: 'AMAZON.NUMBER', required: false },
          {
            argument: 'destination',
            slot: 'destination',
            slotType: 'AMAZON.SearchQuery',
            required: true,
          },
        ],
        elicitedArguments: [],
        inputSchema: {},
      },
      ['search hotels', 'search hotels guests {guests}'],
    );
    expect(phrase).toBe('search hotels guests two');
  });

  const findPark = (inputSchema: Record<string, unknown>) => ({
    name: 'find_park',
    intent: 'FindParkIntent',
    slots: [{ argument: 'query', slot: 'query', slotType: 'AMAZON.SearchQuery', required: true }],
    elicitedArguments: [],
    inputSchema,
  });

  it('never fills a free-text slot with a placeholder (D61)', () => {
    const phrase = examplePhrase(findPark({}), ['find a park for {query}', 'find me a park']);
    expect(phrase).toBe('find me a park');
    expect(examplePhrase(findPark({}), ['find a park for {query}'])).toBe('find park');
  });

  it("fills a free-text slot from the schema's own example", () => {
    const schema = { properties: { query: { type: 'string', examples: ['Quiet Lakes'] } } };
    expect(examplePhrase(findPark(schema), ['find a park for {query}'])).toBe(
      'find a park for quiet lakes',
    );
  });
});

describe('combineOverrides', () => {
  const empty = { utterances: {}, catchAll: [], slotSynonyms: {}, intents: [] };
  it('puts profile samples first and lets a profile intent replace a repo one', () => {
    const repo = {
      ...empty,
      utterances: { A: ['repo a'] },
      catchAll: ['repo c'],
      intents: [{ name: 'XIntent', tool: 't', samples: ['repo x'] }],
    };
    const profile = {
      ...empty,
      utterances: { A: ['profile a'] },
      catchAll: ['profile c'],
      intents: [{ name: 'XIntent', tool: 't', samples: ['profile x'] }],
    };
    const out = combineOverrides(repo, profile);
    expect(out.utterances['A']).toEqual(['profile a', 'repo a']);
    expect(out.catchAll).toEqual(['profile c', 'repo c']);
    expect(out.intents).toEqual(profile.intents);
  });
});
