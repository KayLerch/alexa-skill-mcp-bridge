import { defineConfig } from '@alexa-mcp-bridge/core';

/**
 * THE config file. Every developer input lives here and nowhere else.
 * Every consumer validates it with zod at load time; invalid values fail early with the
 * field path and the fix. Secrets never go in this file: put a Secrets Manager secret
 * name in `mcp.auth.secretName` and the runtime fetches the value at startup.
 *
 * After changing anything under `mcp.*`, `skill.invocationName`, or `skill.locales`,
 * run `npm run generate`. After changing anything else that reaches AWS, run `npm run deploy`.
 */
export default defineConfig({
  mcp: {
    // Required. Your MCP server's Streamable HTTP endpoint. The default points at the
    // bundled sample server (`npm run sample:start`) so `npm run chat` works out of the box.
    // For device tests the URL must be reachable from AWS (see examples/sample-mcp-server/README.md).
    url: 'http://localhost:3939/mcp',

    auth: {
      // 'none' | 'bearer' | 'apiKey' | 'oauthClientCredentials'
      type: 'none',
      // Secrets Manager secret name. bearer: the token. apiKey: the key.
      // oauthClientCredentials: JSON {"clientId": "...", "clientSecret": "..."}.
      // secretName: 'alexa-mcp-bridge/mcp-token',
      // Header for apiKey auth. Default x-api-key.
      // headerName: 'x-api-key',
      // OAuth scopes for oauthClientCredentials.
      // scopes: ['tools:read'],
    },

    // Minimum MCP protocol version. The bridge refuses servers that negotiate anything older.
    protocolVersion: '2025-11-25',
  },

  skill: {
    // What the user says after "Alexa, open ...". Lowercase words only.
    invocationName: 'my bridge',
    // Set after `ask deploy` prints the skill id, then run `npm run deploy` again so the
    // Lambda only accepts requests from this skill.
    // id: 'amzn1.ask.skill.00000000-0000-0000-0000-000000000000',
    // Only en-US ships today. The code path is per-locale; nothing hardcodes en-US.
    locales: ['en-US'],
    // Spoken on launch. Unset: derived from the server name and two example phrases.
    // greeting: 'Welcome. Ask me about hotels or the weather.',
    coldStartMessage: "I'm still starting up. Give me a moment and open me again.",
    stillWorkingMessage: "I'm still working on that. Ask me again in a moment.",
  },

  agent: {
    // Bedrock model id. Nova 2 Lite via its cross-region inference profile.
    modelId: 'us.amazon.nova-2-lite-v1:0',
    // Nova 2 reasoning effort: 'off' | 'low' | 'medium' | 'high'. 'off' sends no reasoning
    // config and is what the 6.5 s turn budget assumes; 'low' adds about 1.5 s per turn.
    reasoningEffort: 'off',
    // Documented alternative if Nova's tool choice disappoints. Not used unless you set it
    // as modelId; enable model access for it first.
    // fallbackModelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    // Cap on spoken output tokens per answer.
    maxTokens: 400,
  },

  runtime: {
    // AgentCore keeps the microVM (and a parked elicitation) alive this long between turns.
    // Memory is billed while the session exists; a 20-minute idle costs a fraction of a cent.
    idleTimeoutMinutes: 20,
    maxLifetimeHours: 8,
  },

  turn: {
    // The agent call's share of Alexa's 8-second limit. The Lambda aborts at this point.
    budgetMs: 6500,
  },

  elicitation: {
    // A question waiting for a spoken answer is cancelled after this long.
    answerTimeoutSeconds: 120,
  },

  memory: {
    // Store every user and assistant turn in AgentCore Memory and rehydrate on cold start.
    shortTerm: true,
    // Long-term user preference and summary extraction. Costs a model call per session.
    longTerm: true,
    // Events rehydrated into the agent's history on cold start.
    hydrateLastEvents: 20,
  },

  features: {
    // Route MCP calls through AgentCore Gateway. Off by default: adds a hop and per-call billing.
    gateway: false,
    // Include tool calls and timings in responses and logs.
    debug: false,
  },

  aws: {
    // Only us-east-1 has been verified.
    region: 'us-east-1',
    // AWS Budgets alarm threshold (USD per month).
    budgetUsd: 5,
    // Where the budget alarm emails. Unset: the deploy prints a warning and no email is sent.
    // budgetEmail: 'you@example.com',
    logRetentionDays: 7,
  },
});
