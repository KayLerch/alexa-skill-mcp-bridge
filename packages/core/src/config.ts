import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The bridge config schema. Every field except mcp.url has a safe default.
 * Every consumer (generator, Lambda, agent, CDK) validates through parseConfig().
 * Secrets never live here: config holds a Secrets Manager secret name only.
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

const MIN_PROTOCOL_VERSION = '2025-11-25';

export const bridgeConfigSchema = z.object({
  mcp: z.object({
    url: z.url({
      error:
        'set mcp.url to your MCP server’s Streamable HTTP endpoint, e.g. https://example.com/mcp',
    }),
    auth: mcpAuthSchema.prefault({}),
    /** Minimum protocol version the client requires. Servers below it are refused. */
    protocolVersion: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like 2025-11-25')
      .refine((v) => v >= MIN_PROTOCOL_VERSION, `must be ${MIN_PROTOCOL_VERSION} or later`)
      .default(MIN_PROTOCOL_VERSION),
  }),
  skill: z
    .object({
      invocationName: z.string().min(2).default('my bridge'),
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
    })
    .prefault({}),
  aws: z
    .object({
      region: z.string().min(1).default('us-east-1'),
      budgetUsd: z.number().positive().default(5),
      budgetEmail: z.email().optional(),
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
 * Load and validate bridge.config.ts. Used by the generator, the CLI, the CDK app, and scripts.
 * Node 22 strips the types on import; the file must use erasable syntax only.
 */
export async function loadConfigFile(path?: string): Promise<BridgeConfig> {
  const file = path ?? process.env.BRIDGE_CONFIG_PATH ?? findConfigFile();
  if (!file) {
    throw new ConfigError(
      `${CONFIG_FILE_NAME} not found in ${process.cwd()} or any parent directory.`,
    );
  }
  const mod = (await import(pathToFileURL(resolve(file)).href)) as { default?: unknown };
  if (mod.default === undefined) {
    throw new ConfigError(`${file} must export the result of defineConfig() as default.`);
  }
  return parseConfig(mod.default);
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
