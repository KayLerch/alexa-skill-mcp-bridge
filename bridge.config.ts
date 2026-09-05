import { defineConfig } from '@alexa-mcp-bridge/core';

/**
 * THE config file: the settings of the bridge itself, and it is meant to stay committable
 * exactly as it ships. Every consumer validates it with zod at load time; invalid values
 * fail early with the field path and the fix.
 *
 * What is yours rather than the project's goes in a git-ignored `.env` instead (copy
 * `.env.example`), which overrides the fields below: your MCP URL, your secret name, your
 * skill id, your region. Secrets themselves never live in either file: put a Secrets Manager
 * secret name in `mcp.auth.secretName` and the runtime fetches the value at startup.
 *
 * After changing anything under `mcp.*`, `skill.invocationName`, or `skill.locales`,
 * run `npm run generate`. After changing anything else that reaches AWS, run `npm run deploy`.
 */
export default defineConfig({
  mcp: {
    // Required. Your MCP server's Streamable HTTP endpoint. The default points at the
    // bundled sample server (`npm run sample:start`) so `npm run chat` works out of the box.
    // Point at your own server with BRIDGE_MCP_URL in .env rather than editing this line.
    // For device tests the URL must be reachable from AWS (see examples/hotels-weather-mcp-server/README.md).
    url: 'http://localhost:3939/mcp',
    auth: {
      // 'none' | 'bearer' | 'apiKey' | 'oauthClientCredentials'
      type: 'none',
      // Secrets Manager secret name (BRIDGE_MCP_SECRET_NAME in .env). bearer: the token.
      // apiKey: the key. oauthClientCredentials: JSON {"clientId": "...", "clientSecret": "..."}.
      // secretName: 'alexa-mcp-bridge/mcp-token',
      // Header for apiKey auth. Default x-api-key.
      // headerName: 'x-api-key',
      // OAuth scopes for oauthClientCredentials.
      // scopes: ['tools:read'],
    },
  },

  skill: {
    // What the user says after "Alexa, open ...". Lowercase words only.
    invocationName: 'bridge demo',
    // Your skill id goes in .env as BRIDGE_SKILL_ID, not here. Set it after `ask deploy`
    // prints it and run `npm run deploy` again so the Lambda only accepts your skill.
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

  speech: {
    // Voice rules the agent and the question renderer both follow.
    // How many sentences a spoken answer may run to.
    maxSentences: 3,
    // How many options a question reads aloud. Past this it names a few as examples instead;
    // the answer still accepts anything the tool's schema allows. Nobody wants twelve months read out.
    maxChoicesSpoken: 3,
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
    // One Alexa intent per MCP tool, with typed slots and entity resolution. Turn this off to
    // send the whole spoken phrase to the agent instead: the interaction model then stops
    // depending on your tool schemas, so changing a tool needs no `ask deploy` (D38).
    toolIntents: true,
    // Also add a catch-all intent, so anything the tool intents do not recognise still reaches
    // the agent as text instead of vanishing in Alexa's fallback (which carries no text).
    catchAll: true,
  },

  aws: {
    // Only us-east-1 has been verified. BRIDGE_AWS_REGION in .env overrides it.
    region: 'us-east-1',
    logRetentionDays: 7,
  },
});
