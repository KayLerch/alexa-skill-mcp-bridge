import { z } from 'zod';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

/**
 * The bridge config schema. Every field except mcp.url has a safe default.
 * Every consumer (generator, Lambda, agent, CDK) validates through parseConfig().
 * Secrets never live here: config holds a Secrets Manager secret name only.
 *
 * The few fields that identify you rather than the setup (your endpoint, your secret
 * name, your Alexa Skill id) can come from a git-ignored .env instead, so bridge.config.ts
 * stays committable as it ships. See ENV_OVERRIDES below and docs/config.md.
 */

export const PROMPT_ADDENDUM_MAX_BYTES = 2000;

export const mcpAuthSchema = z
  .object({
    /**
     * alexaAccountLinking: no shared secret. Each request carries the user's own token from
     * Alexa account linking, and a user without one is asked to link (D48).
     */
    type: z
      .enum(['none', 'bearer', 'apiKey', 'oauthClientCredentials', 'alexaAccountLinking'])
      .default('none'),
    /** Secrets Manager secret holding the token, API key, or {clientId, clientSecret} JSON. */
    secretName: z.string().min(1).optional(),
    /** Header name for apiKey auth. Default x-api-key. */
    headerName: z.string().min(1).optional(),
    /** OAuth scopes for oauthClientCredentials. */
    scopes: z.array(z.string()).optional(),
  })
  .superRefine((auth, ctx) => {
    if (auth.type !== 'none' && auth.type !== 'alexaAccountLinking' && !auth.secretName) {
      ctx.addIssue({
        code: 'custom',
        path: ['secretName'],
        message:
          `required when auth.type is '${auth.type}'. Create it with ` +
          `aws secretsmanager create-secret --name <name> --secret-string '<value>' and put <name> here.`,
      });
    }
  });
export type McpAuthConfig = z.output<typeof mcpAuthSchema>;

/** A tool call the bridge makes itself, without the model: the tool's name and fixed arguments. */
export const directToolCallSchema = z.strictObject({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
export type DirectToolCall = z.output<typeof directToolCallSchema>;

/** What a mapped built-in intent does: a direct tool call, or a text the agent hears (D59). */
export const builtInActionSchema = z.union([
  directToolCallSchema,
  z.strictObject({ text: z.string().trim().min(1) }),
]);
export type BuiltInAction = z.output<typeof builtInActionSchema>;

/** Built-ins that end the session whatever the mapping does. */
export const SESSION_ENDING_INTENTS = [
  'AMAZON.StopIntent',
  'AMAZON.CancelIntent',
  'AMAZON.NavigateHomeIntent',
] as const;

/** Built-in intents `intents.builtIns` may map. Repeat and Help have fixed behaviour. */
export const MAPPABLE_BUILT_IN_INTENTS = [
  'AMAZON.NextIntent',
  'AMAZON.PreviousIntent',
  'AMAZON.StartOverIntent',
  'AMAZON.MoreIntent',
  ...SESSION_ENDING_INTENTS,
] as const;
export type MappableBuiltInIntent = (typeof MAPPABLE_BUILT_IN_INTENTS)[number];

/**
 * A value Alexa accepts in a custom slot type and a sample utterance: lowercase words of letters
 * with apostrophes, joined by single spaces or hyphens. No digits, no other punctuation.
 */
export const SPOKEN_WORDS = /^[a-z']+(?:[ -][a-z']+)*$/;
/**
 * Spoken words, or a letter in Alexa's spelled form ("a.", "option b."): a lone letter said aloud reaches the skill as
 * "A.", and without that form as a slot value it falls to AMAZON.FallbackIntent (D73). Synonyms only.
 */
export const SPOKEN_WORDS_OR_LETTERS = /^(?:[a-z']+|[a-z]\.)(?:[ -](?:[a-z']+|[a-z]\.))*$/;
const spokenWords = z
  .string()
  .max(140)
  .regex(SPOKEN_WORDS, 'lowercase words: letters, apostrophes, spaces and hyphens, no digits');
const spokenSynonym = z
  .string()
  .max(140)
  .regex(
    SPOKEN_WORDS_OR_LETTERS,
    'lowercase words or a spelled letter ("a."): letters, apostrophes, spaces and hyphens, no digits',
  );

/** The default `visual.idleTimeoutMs`: how long the screen asks to stay up without activity. */
export const SCREEN_IDLE_TIMEOUT_MS = 60_000;

const bridgeConfigShape = z.object({
  mcp: z.object({
    url: z.url({
      error:
        'set mcp.url to your MCP server’s Streamable HTTP endpoint, e.g. https://example.com/mcp',
    }),
    auth: mcpAuthSchema.prefault({}),
  }),
  skill: z
    .object({
      invocationName: z.string().min(2).default('bridge demo'),
      /** Set after `ask deploy`; tightens the Lambda permission on the next `npm run deploy`. */
      id: z
        .string()
        .regex(/^amzn1\.ask\.skill\.[0-9a-f-]+$/, 'must look like amzn1.ask.skill.<uuid>')
        .optional(),
      locales: z
        .array(z.string().regex(/^[a-z]{2}-[A-Z]{2}$/))
        .min(1)
        .default(['en-US']),
      /** Default is derived from the server name and two example phrases in the manifest. */
      greeting: z.string().optional(),
      coldStartMessage: z
        .string()
        .default("I'm still starting up. Give me a moment and open me again."),
      /**
       * Spoken when a turn runs past the budget. Whatever the user says next fetches that result
       * and only that (D72), so the line tells them what to say.
       */
      stillWorkingMessage: z.string().default('Still working on it. Say "continue" in a moment.'),
      /** The reprompt after stillWorkingMessage. */
      stillWorkingReprompt: z.string().default('Say "continue" to hear it.'),
      /**
       * A tool the agent calls directly on launch, without the model (D57). Its
       * speech.resultField is spoken, its widget shown, and the session ends only when
       * speech.endSessionField says so. Unset, or when the call gives nothing to say: the greeting.
       */
      launch: directToolCallSchema.optional(),
      /** Spoken for "help". Unset: the server's tools and example phrases, generated. */
      help: z.string().trim().min(1).optional(),
      /** Example phrases for the greeting and help. Unset: two generated from the tool manifest. */
      examplePhrases: z.array(z.string().trim().min(1)).min(1).optional(),
      /**
       * Said, followed by the last question again, when Alexa did not catch an answer while the
       * session is open for one (D60). Never the generic "What would you like to do?".
       */
      fallbackWhileOpen: z.string().trim().min(1).default("Sorry, I didn't catch that."),
      /**
       * How readily Alexa sends an utterance to AMAZON.FallbackIntent instead of the closest
       * intent: the interaction model's fallbackIntentSensitivity. Unset: Alexa's default (LOW).
       */
      fallbackSensitivity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    })
    .prefault({}),
  agent: z
    .object({
      modelId: z.string().min(1).default('us.amazon.nova-2-lite-v1:0'),
      /**
       * Nova 2 reasoning effort. 'off' sends no reasoningConfig and is the fastest setting,
       * which is what the turn budget assumes (measured: about 1.5 s per turn saved over 'low').
       */
      reasoningEffort: z.enum(['off', 'low', 'medium', 'high']).default('off'),
      /** Documented alternative, e.g. us.anthropic.claude-haiku-4-5-20251001-v1:0. Unused when unset. */
      fallbackModelId: z.string().min(1).optional(),
      /** Cap on spoken output. Short answers are the point. */
      maxTokens: z.number().int().positive().max(2000).default(400),
      /**
       * Extra guidance for the MCP server this bridge talks to, appended to the system prompt
       * under "Server-specific guidance". Normally filled from <BRIDGE_PROFILE_DIR>/prompt-addendum.md
       * at load time (D56); the deployed agent gets it as BRIDGE_PROMPT_ADDENDUM, its own variable.
       * Capped at 2000 UTF-8 bytes because AgentCore caps a runtime variable at 2048 characters.
       */
      promptAddendum: z
        .string()
        .trim()
        .min(1)
        .refine((text) => Buffer.byteLength(text, 'utf8') <= PROMPT_ADDENDUM_MAX_BYTES, {
          message: `must be at most ${PROMPT_ADDENDUM_MAX_BYTES} bytes of UTF-8`,
        })
        .optional(),
    })
    .prefault({}),
  runtime: z
    .object({
      /** AgentCore reclaims the microVM after this idle period. Memory is billed while it exists. */
      idleTimeoutMinutes: z.number().int().min(1).max(480).default(20),
      maxLifetimeHours: z.number().int().min(1).max(8).default(8),
    })
    .prefault({}),
  turn: z
    .object({
      /** The agent call's share of Alexa's 8 s limit. */
      budgetMs: z.number().int().min(1000).max(7500).default(6500),
      /**
       * After this long without an answer the Alexa Skill says "One moment." (Progressive
       * Response), once per request (D52). 0 turns it off. Below budgetMs, or it never fires.
       * The default sits above a normal turn (1.5 to 3 s), so only a slow one hears it (D71).
       */
      progressiveAfterMs: z.number().int().min(0).max(7000).default(3000),
    })
    .prefault({}),
  tools: z
    .object({
      /**
       * Argument names the agent fills itself (D50): never an Alexa slot, never in a sample
       * utterance. A missing one is taken from the latest tool result that carries that key.
       */
      hiddenArguments: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
  /** Voice rules that both the prompt and the deterministic renderers obey. */
  speech: z
    .object({
      /** How long a spoken answer may be. Interpolated into the voice prompt. */
      maxSentences: z.number().int().min(1).max(5).default(3),
      /**
       * How many options a question may read aloud. Beyond this the question names a few as
       * examples; the answer mapper still accepts any value the schema allows.
       */
      maxChoicesSpoken: z.number().int().min(1).max(10).default(3),
      /**
       * A string field of a tool result's structuredContent to speak verbatim (D51), for servers
       * that write their own spoken line. The model's rephrasing is ignored when the run's last
       * successful result has it; otherwise the model's text is spoken as usual.
       */
      resultField: z.string().min(1).optional(),
      /**
       * A boolean field of a tool result's structuredContent that ends the session when true
       * (D58). With it set, a finished turn ends the session only when the run's last successful
       * result says so; otherwise it stays open. Unset: the session ends when the speech does not
       * end with a question.
       */
      endSessionField: z.string().min(1).optional(),
      /**
       * A string field of a tool result's structuredContent that the Alexa Skill speaks, exactly,
       * when Alexa misses the user's reply while the session is open for one (D70): a hint the
       * server wrote for its own question ('Say A, B or C, or "skip".'). Read from the run's last
       * successful result; unset or absent: skill.fallbackWhileOpen and the last question (D60).
       */
      fallbackField: z.string().min(1).optional(),
    })
    .prefault({}),
  intents: z
    .object({
      /**
       * Alexa built-in intents mapped to a direct tool call (no model) or to a turn text the
       * agent hears as if the user had said it (D59). Stop, Cancel and NavigateHome take a tool
       * only: its result field is the farewell when the result ends the session on its own; an
       * error, an empty field, a timeout or a closing question leaves the plain goodbye, and the
       * session ends either way.
       */
      builtIns: z.partialRecord(z.enum(MAPPABLE_BUILT_IN_INTENTS), builtInActionSchema).default({}),
    })
    .prefault({}),
  elicitation: z
    .object({
      /** A parked question is cancelled after this long without an answer. */
      answerTimeoutSeconds: z.number().int().min(10).max(600).default(120),
    })
    .prefault({}),
  memory: z
    .object({
      shortTerm: z.boolean().default(true),
      /** Long-term extraction costs a model call per session. See docs/cost.md. */
      longTerm: z.boolean().default(true),
      hydrateLastEvents: z.number().int().min(0).max(100).default(20),
    })
    .prefault({}),
  features: z
    .object({
      /** Route MCP traffic through AgentCore Gateway. Off by default; adds a hop and per-call billing. */
      gateway: z.boolean().default(false),
      /** Include tool calls and timings in TurnOutput.debug and log tool arguments. */
      debug: z.boolean().default(false),
      /**
       * Generate one Alexa intent per MCP tool, with typed slots and entity resolution (D38).
       * Off: one catch-all intent hands the whole phrase to the agent, and the interaction
       * model stops changing when your tools change.
       */
      toolIntents: z.boolean().default(true),
      /**
       * Add a catch-all intent beside the tool intents, so a request the tool intents do not
       * recognise still reaches the agent as text instead of dying in AMAZON.FallbackIntent.
       */
      catchAll: z.boolean().default(true),
    })
    .prefault({}),
  visual: z
    .object({
      /**
       * Render a tool result's MCP Apps widget (`_meta.ui.resourceUri`) to an image for devices
       * with a screen (D54). Starts a headless Chromium in the agent container at warm-up.
       */
      enabled: z.boolean().default(false),
      /**
       * How long the screen should stay up without activity, in milliseconds: the APL
       * document's settings.idleTimeout (D68). A recommendation; the device may bound it.
       */
      idleTimeoutMs: z.number().int().min(10_000).default(SCREEN_IDLE_TIMEOUT_MS),
    })
    .prefault({}),
  answers: z
    .object({
      /**
       * Extra values for the answer-choice slot type (D67): a canonical value and the spoken
       * synonyms that resolve to it, e.g. { b: ['bee', 'option b'] }. "bee" then reaches the
       * agent as "b". Read by the generator only; change it, then npm run generate.
       */
      choices: z.record(spokenWords, z.array(spokenSynonym)).default({}),
      /**
       * Which of the bridge's own answer intents ship (D69); unset ships all four. With tool
       * intents off, ['choice'] leaves every other answer to the catch-all, word for word: a date
       * or number intent would rewrite "on friday" as an ISO date. Read by the generator only.
       */
      intents: z
        .array(z.enum(['date', 'number', 'freeText', 'choice']))
        .min(1)
        .optional(),
    })
    .prefault({}),
  aws: z
    .object({
      region: z.string().min(1).default('us-east-1'),
      logRetentionDays: z.number().int().positive().default(7),
    })
    .prefault({}),
});

export const bridgeConfigSchema = bridgeConfigShape.superRefine((config, ctx) => {
  // One spoken phrase resolves to one choice: Alexa would pick either, silently.
  const owner = new Map<string, string>();
  for (const [choice, synonyms] of Object.entries(config.answers.choices)) {
    for (const synonym of synonyms) {
      const message =
        synonym in config.answers.choices && synonym !== choice
          ? `"${synonym}" is itself a choice`
          : owner.has(synonym) && owner.get(synonym) !== choice
            ? `"${synonym}" is already a synonym of "${owner.get(synonym)}"`
            : undefined;
      if (message) ctx.addIssue({ code: 'custom', path: ['answers', 'choices', choice], message });
      if (!owner.has(synonym)) owner.set(synonym, choice);
    }
  }
  // A goodbye intent cannot hand the turn to the model: the session ends right after it.
  for (const intent of SESSION_ENDING_INTENTS) {
    const action = config.intents.builtIns[intent];
    if (action && !('tool' in action)) {
      ctx.addIssue({
        code: 'custom',
        path: ['intents', 'builtIns', intent],
        message:
          'takes a tool ({ "tool": "...", "arguments": {...} }), not a text: the session ends right after it.',
      });
    }
  }
  // The Lambda stops waiting at the budget, and the progressive response with it.
  if (
    config.turn.progressiveAfterMs > 0 &&
    config.turn.progressiveAfterMs >= config.turn.budgetMs
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['turn', 'progressiveAfterMs'],
      message: `must be below turn.budgetMs (${config.turn.budgetMs}), or 0 to turn it off: the Alexa Skill stops waiting at the budget.`,
    });
  }
  // The Gateway authenticates the agent with SigV4 and has no way to pass the user's token on.
  if (config.features.gateway && config.mcp.auth.type === 'alexaAccountLinking') {
    ctx.addIssue({
      code: 'custom',
      path: ['features', 'gateway'],
      message:
        "cannot be combined with mcp.auth.type 'alexaAccountLinking': the Gateway does not " +
        "forward the user's token. Turn the Gateway off.",
    });
  }
});

export type BridgeConfig = z.output<typeof bridgeConfigSchema>;
export type BridgeConfigInput = z.input<typeof bridgeConfigSchema>;

/** Identity function that gives bridge.config.ts its types and completions. */
export function defineConfig(config: BridgeConfigInput): BridgeConfigInput {
  return config;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Validate raw config. Errors list the field path and what to change. */
export function parseConfig(raw: unknown): BridgeConfig {
  const result = bridgeConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join('.') : '(root)';
    return `  ${path}: ${issue.message}`;
  });
  throw new ConfigError(`Invalid bridge config:\n${lines.join('\n')}`);
}

export const CONFIG_FILE_NAME = 'bridge.config.ts';
export const CONFIG_ENV_VAR = 'BRIDGE_CONFIG';
/**
 * The agent runtime gets the prompt addendum in a variable of its own, as a JSON string:
 * AgentCore caps each runtime environment variable at 2048 characters (the addendum alone may
 * be 2000 bytes) and refuses control characters such as newlines.
 */
export const PROMPT_ADDENDUM_ENV_VAR = 'BRIDGE_PROMPT_ADDENDUM';
/** AgentCore Runtime's limit on one environment variable's value, in characters. */
export const RUNTIME_ENV_VALUE_MAX = 2048;
export const ENV_FILE_NAME = '.env';

/**
 * Environment variables that override bridge.config.ts, and the field each one sets.
 * Deliberately short: only what is yours rather than the project's, so nobody has to
 * edit (and then accidentally commit) the tracked config file. The secret *value* is
 * not here; that stays MCP_SECRET_VALUE for local runs and Secrets Manager in AWS.
 */
export const ENV_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  BRIDGE_MCP_URL: ['mcp', 'url'],
  BRIDGE_MCP_AUTH_TYPE: ['mcp', 'auth', 'type'],
  BRIDGE_MCP_SECRET_NAME: ['mcp', 'auth', 'secretName'],
  BRIDGE_SKILL_ID: ['skill', 'id'],
  BRIDGE_AWS_REGION: ['aws', 'region'],
};

/** Apply ENV_OVERRIDES to raw config before it is validated, so zod checks the merged result. */
export function applyEnvOverrides(raw: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  let merged = raw as Record<string, unknown>;
  for (const [name, path] of Object.entries(ENV_OVERRIDES)) {
    const value = env[name]?.trim();
    if (value) merged = setPath(merged, path, value);
  }
  return merged;
}

function setPath(
  target: Record<string, unknown>,
  path: readonly string[],
  value: string,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return target;
  if (rest.length === 0) return { ...target, [head]: value };
  const child = target[head];
  const branch =
    typeof child === 'object' && child !== null ? (child as Record<string, unknown>) : {};
  return { ...target, [head]: setPath({ ...branch }, rest, value) };
}

/** Load .env next to bridge.config.ts. Real environment variables win over the file (Node's rule). */
export function loadEnvFile(dir: string): void {
  const file = join(dir, ENV_FILE_NAME);
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Where a consumer keeps its own .env, overrides and prompt addendum, outside this repo (D56). */
export const PROFILE_DIR_ENV = 'BRIDGE_PROFILE_DIR';
export const PROFILE_ADDENDUM_FILE = 'prompt-addendum.md';

/**
 * The profile folder from BRIDGE_PROFILE_DIR, or undefined when unset. A relative path resolves
 * against `repoRoot`. A folder that does not exist is a config error; files missing inside it are fine.
 */
export function resolveProfileDir(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[PROFILE_DIR_ENV]?.trim();
  if (!value) return undefined;
  const dir = resolve(repoRoot, value);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new ConfigError(
      `${PROFILE_DIR_ENV} points to ${dir}, which is not a directory. ` +
        'Create it, fix the path, or unset the variable.',
    );
  }
  return dir;
}

/**
 * Read <profile>/.env after the repo's own. The profile beats the repo's .env, a real
 * environment variable beats both, and the profile cannot set BRIDGE_PROFILE_DIR (no chaining).
 */
export function loadProfileEnv(profileDir: string, realEnvKeys: ReadonlySet<string>): void {
  const file = join(profileDir, ENV_FILE_NAME);
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (key === PROFILE_DIR_ENV || realEnvKeys.has(key) || value === undefined) continue;
    process.env[key] = value;
  }
}

export const PROFILE_OVERLAY_FILE = 'bridge.config.json';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Objects merge key by key, everything else (arrays included) is replaced by the overlay. */
export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (!isRecord(base) || !isRecord(overlay)) return overlay;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = deepMerge(base[key], value);
  }
  return out;
}

/** Key paths of the overlay that the validated config does not have: zod strips unknown keys. */
export function unknownOverlayPaths(
  overlay: unknown,
  config: unknown,
  prefix: readonly string[] = [],
): string[] {
  if (!isRecord(overlay)) return [];
  const known = isRecord(config) ? config : {};
  return Object.entries(overlay).flatMap(([key, value]) =>
    Object.hasOwn(known, key)
      ? unknownOverlayPaths(value, known[key], [...prefix, key])
      : [[...prefix, key].join('.')],
  );
}

/** The profile's partial config (bridge.config.json), or undefined when there is none. */
export function readProfileOverlay(profileDir: string): Record<string, unknown> | undefined {
  const file = join(profileDir, PROFILE_OVERLAY_FILE);
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ConfigError(`${file} is not valid JSON.`);
  }
  if (!isRecord(parsed)) throw new ConfigError(`${file} must be a JSON object.`);
  return parsed;
}

/** The profile's prompt addendum, trimmed, or undefined when there is none. */
export function readPromptAddendum(profileDir: string): string | undefined {
  const file = join(profileDir, PROFILE_ADDENDUM_FILE);
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8').trim() || undefined;
}

/** Walk up from `from` until a bridge.config.ts is found. */
export function findConfigFile(from: string = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load and validate bridge.config.ts, with .env applied on top (and the profile folder's, D56). Used by the generator, the
 * CLI, the CDK app, and scripts. Node 22 strips the types on import; the file must use
 * erasable syntax only. The Lambda and the container do not come through here: they read the
 * already-merged config from BRIDGE_CONFIG.
 */
export async function loadConfigFile(path?: string): Promise<BridgeConfig> {
  const file = path ?? process.env.BRIDGE_CONFIG_PATH ?? findConfigFile();
  if (!file) {
    throw new ConfigError(
      `${CONFIG_FILE_NAME} not found in ${process.cwd()} or any parent directory.`,
    );
  }
  const repoRoot = dirname(resolve(file));
  const realEnvKeys = new Set(Object.keys(process.env));
  loadEnvFile(repoRoot);
  const profileDir = resolveProfileDir(repoRoot);
  if (profileDir) loadProfileEnv(profileDir, realEnvKeys);
  const mod = (await import(pathToFileURL(resolve(file)).href)) as { default?: unknown };
  if (mod.default === undefined) {
    throw new ConfigError(`${file} must export the result of defineConfig() as default.`);
  }
  // Order: bridge.config.ts < profile bridge.config.json < environment overrides (repo .env,
  // profile .env, real variables). The env wins so a one-off `BRIDGE_MCP_URL=… npm run chat`
  // still works with a profile set.
  const overlay = profileDir ? readProfileOverlay(profileDir) : undefined;
  let raw = applyEnvOverrides(overlay ? deepMerge(mod.default, overlay) : mod.default);
  const addendum = profileDir ? readPromptAddendum(profileDir) : undefined;
  if (addendum && typeof raw === 'object' && raw !== null) {
    const agent = (raw as { agent?: unknown }).agent;
    raw = {
      ...raw,
      agent: {
        ...(typeof agent === 'object' && agent !== null ? agent : {}),
        promptAddendum: addendum,
      },
    };
  }
  try {
    const config = parseConfig(raw);
    const unknown = overlay ? unknownOverlayPaths(overlay, config) : [];
    if (unknown.length) {
      throw new ConfigError(
        `${join(profileDir as string, PROFILE_OVERLAY_FILE)} has fields the config does not know ` +
          `(a typo would silently keep the default): ${unknown.join(', ')}`,
      );
    }
    return config;
  } catch (err) {
    if (overlay && err instanceof ConfigError) {
      throw new ConfigError(
        `${err.message}\n  (the profile overlay ${join(profileDir as string, PROFILE_OVERLAY_FILE)} was applied)`,
      );
    }
    throw err;
  }
}

/**
 * Load config from the BRIDGE_CONFIG env var, plus the prompt addendum from
 * BRIDGE_PROMPT_ADDENDUM when set. Used by the Lambda and the container.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const raw = env[CONFIG_ENV_VAR];
  if (!raw) {
    throw new ConfigError(
      `${CONFIG_ENV_VAR} is not set. The CDK stack sets it from bridge.config.ts.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${CONFIG_ENV_VAR} is not valid JSON.`);
  }
  const encoded = env[PROMPT_ADDENDUM_ENV_VAR];
  if (encoded && parsed && typeof parsed === 'object') {
    // A JSON string, because AgentCore refuses control characters such as newlines in a value.
    let addendum: unknown;
    try {
      addendum = JSON.parse(encoded);
    } catch {
      throw new ConfigError(`${PROMPT_ADDENDUM_ENV_VAR} is not a JSON string.`);
    }
    const withAgent = parsed as { agent?: Record<string, unknown> };
    withAgent.agent = { ...withAgent.agent, promptAddendum: addendum };
  }
  return parseConfig(parsed);
}

/** The env var form of a validated config. */
export function serializeConfig(config: BridgeConfig): string {
  return JSON.stringify(config);
}
