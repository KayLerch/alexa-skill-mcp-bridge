import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

export const mcpAuthSchema = z
  .object({
    type: z.enum(['none', 'bearer', 'apiKey', 'oauthClientCredentials']).default('none'),
    /** Secrets Manager secret holding the token, API key, or {clientId, clientSecret} JSON. */
    secretName: z.string().min(1).optional(),
    /** Header name for apiKey auth. Default x-api-key. */
    headerName: z.string().min(1).optional(),
    /** OAuth scopes for oauthClientCredentials. */
    scopes: z.array(z.string()).optional(),
  })
  .superRefine((auth, ctx) => {
    if (auth.type !== 'none' && !auth.secretName) {
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

export const bridgeConfigSchema = z.object({
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
      stillWorkingMessage: z
        .string()
        .default("I'm still working on that. Ask me again in a moment."),
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
  aws: z
    .object({
      region: z.string().min(1).default('us-east-1'),
      logRetentionDays: z.number().int().positive().default(7),
    })
    .prefault({}),
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
 * Load and validate bridge.config.ts, with .env applied on top. Used by the generator, the
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
  loadEnvFile(dirname(resolve(file)));
  const mod = (await import(pathToFileURL(resolve(file)).href)) as { default?: unknown };
  if (mod.default === undefined) {
    throw new ConfigError(`${file} must export the result of defineConfig() as default.`);
  }
  return parseConfig(applyEnvOverrides(mod.default));
}

/** Load config from the BRIDGE_CONFIG env var. Used by the Lambda and the container. */
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
  return parseConfig(parsed);
}

/** The env var form of a validated config. */
export function serializeConfig(config: BridgeConfig): string {
  return JSON.stringify(config);
}
