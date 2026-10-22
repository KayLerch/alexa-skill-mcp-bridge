import {
  JsonBlock,
  TextBlock,
  Tool,
  ToolResultBlock,
  tool,
  type JSONSchema,
  type JSONValue,
  type ToolContext,
  type ToolStreamGenerator,
} from '@strands-agents/sdk';
import { z } from 'zod';
import { errorFields, questionExpectsSchema, type Logger } from '@alexa-mcp-bridge/core';
import { isUnauthorized } from '../mcp/auth.js';
import type { BridgeMcpClient, McpToolDefinition } from '../mcp/client.js';
import { toolResultText, type McpToolResult } from '../mcp/result.js';
import type { QuestionQueue } from '../elicitation/queue.js';
import { loadPrompt } from './prompt.js';

/**
 * Hidden arguments (D50): names the model never has to supply. The latest `structuredContent`
 * value for each name is remembered across tool calls and fills a call that left it out.
 */
export class HiddenArguments {
  private readonly latest = new Map<string, unknown>();

  constructor(private readonly names: readonly string[]) {}

  remember(structured: unknown): void {
    if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return;
    const record = structured as Record<string, unknown>;
    for (const name of this.names) {
      if (record[name] !== undefined) this.latest.set(name, record[name]);
    }
  }

  /** The conversation was forgotten (D48): nothing from the earlier account may carry over. */
  clear(): void {
    this.latest.clear();
  }

  /**
   * Fills each hidden name the call left out. `null` and `""` count as left out: a model that was
   * never told the value often sends an empty one for a required argument.
   */
  fill(args: Record<string, unknown>): Record<string, unknown> {
    const filled = { ...args };
    for (const name of this.names) {
      if (isMissing(filled[name]) && this.latest.has(name)) filled[name] = this.latest.get(name);
    }
    return filled;
  }
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * The fields of the run's latest successful tool result the bridge reads itself: the string to
 * speak verbatim (speech.resultField, D51) and the flag that ends the session
 * (speech.endSessionField, D58). `begin()` runs at the start of every run so nothing leaks across
 * turns.
 */
export class ResultField {
  private latest?: string;
  private ends = false;

  constructor(
    private readonly name?: string,
    private readonly endSessionName?: string,
  ) {}

  begin(): void {
    this.latest = undefined;
    this.ends = false;
  }

  /** Each successful result replaces both values; one without a usable field clears it. */
  record(structured: unknown): void {
    const record =
      structured && typeof structured === 'object' && !Array.isArray(structured)
        ? (structured as Record<string, unknown>)
        : {};
    const value = this.name ? record[this.name] : undefined;
    this.latest = typeof value === 'string' && value.trim() ? value : undefined;
    this.ends = this.endSessionName ? record[this.endSessionName] === true : false;
  }

  get value(): string | undefined {
    return this.latest;
  }

  /** True when speech.endSessionField is set: the result, not the trailing "?", ends the session. */
  get decidesEnd(): boolean {
    return this.endSessionName !== undefined;
  }

  /** The latest result's end-session flag; false unless it is exactly `true`. */
  get endsSession(): boolean {
    return this.ends;
  }
}

/** A tool call whose result has an MCP Apps widget to show (D54). */
export interface WidgetCall {
  resourceUri: string;
  toolName: string;
  input: Record<string, unknown>;
  result: McpToolResult;
}

/**
 * The run's last successful tool call with a widget (D54), for the screen after the run.
 * `begin()` runs at the start of every run; a later call without a widget leaves it in place,
 * so the screen stays on the last thing the server drew. Held in memory only.
 */
export class WidgetRecorder {
  private last?: WidgetCall;

  begin(): void {
    this.last = undefined;
  }

  record(call: WidgetCall): void {
    this.last = call;
  }

  /** The conversation was forgotten (D48): no earlier account's result may reach the screen. */
  clear(): void {
    this.last = undefined;
  }

  get latest(): WidgetCall | undefined {
    return this.last;
  }
}

/** What a successful tool call leaves behind for the rest of the run. */
export interface ToolCallRecorders {
  hidden?: HiddenArguments | undefined;
  resultField?: ResultField | undefined;
  widgets?: WidgetRecorder | undefined;
}

/**
 * One tools/call with the bridge's bookkeeping: hidden arguments filled in (D50), and from a
 * successful result the hidden values, the result fields (D51, D58) and the widget (D54)
 * recorded. Used by the model's tool calls and by direct calls (D57) alike. Throws what the MCP
 * client throws.
 */
export async function callAndRecord(
  client: BridgeMcpClient,
  name: string,
  args: Record<string, unknown>,
  toolResourceUri: string | undefined,
  recorders: ToolCallRecorders,
  signal?: AbortSignal,
): Promise<{ sent: Record<string, unknown>; result: McpToolResult; resourceUri?: string }> {
  const sent = recorders.hidden?.fill(args) ?? args;
  const result = await client.callTool(name, sent, { ...(signal ? { signal } : {}) });
  // The result names its widget; a tool's own declaration is the fallback.
  const resourceUri = result._meta?.ui?.resourceUri ?? toolResourceUri;
  if (!result.isError) {
    recorders.hidden?.remember(result.structuredContent);
    recorders.resultField?.record(result.structuredContent);
    // MCP Apps widgets are ui:// resources; nothing else is read for the screen.
    if (resourceUri?.startsWith('ui://')) {
      recorders.widgets?.record({ resourceUri, toolName: name, input: sent, result });
    }
  }
  return { sent, result, ...(resourceUri ? { resourceUri } : {}) };
}

/**
 * The one content block a tool result becomes for the model. One block only: Nova collapses its
 * context on a result that mixes json and text (measured: 545 input tokens instead of 1712,
 * empty answer; see plan D28).
 */
export function toolResultBlockContent(result: McpToolResult): JsonBlock | TextBlock {
  return !result.isError && result.structuredContent
    ? new JsonBlock({ json: result.structuredContent as JSONValue })
    : new TextBlock(toolResultText(result) || 'The tool returned no content.');
}

/** An MCP tool as a Strands tool. Prefers structuredContent, keeps text, never leaks raw errors. */
export class BridgeMcpTool extends Tool {
  readonly name: string;
  readonly description: string;
  readonly toolSpec: { name: string; description: string; inputSchema: JSONSchema };
  private readonly uiResourceUri?: string;

  constructor(
    definition: McpToolDefinition,
    private readonly client: BridgeMcpClient,
    private readonly logger: Logger,
    private readonly onUnauthorized?: () => void,
    private readonly hidden?: HiddenArguments,
    private readonly resultField?: ResultField,
    private readonly widgets?: WidgetRecorder,
  ) {
    super();
    this.name = definition.name;
    this.uiResourceUri = definition.uiResourceUri;
    this.description = definition.description ?? '';
    this.toolSpec = {
      name: definition.name,
      description: this.description,
      inputSchema: definition.inputSchema as JSONSchema,
    };
  }

  async *stream(context: ToolContext): ToolStreamGenerator {
    const { toolUseId, input } = context.toolUse;
    const args =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    try {
      const { result, resourceUri } = await callAndRecord(
        this.client,
        this.name,
        args,
        this.uiResourceUri,
        { hidden: this.hidden, resultField: this.resultField, widgets: this.widgets },
        context.cancelSignal,
      );
      const content = [toolResultBlockContent(result)];
      if (resourceUri) {
        this.logger.debug('tool result carries a ui resource', { tool: this.name, resourceUri });
      }
      return new ToolResultBlock({
        toolUseId,
        status: result.isError ? 'error' : 'success',
        content,
      });
    } catch (err) {
      if (this.onUnauthorized && isUnauthorized(err)) {
        // The user's token is missing, expired or revoked: no retry, the run ends with the link prompt.
        this.logger.warn('mcp server refused the account-linked token', { tool: this.name });
        this.onUnauthorized();
        return new ToolResultBlock({
          toolUseId,
          status: 'error',
          content: [new TextBlock('The user needs to link their account first.')],
        });
      }
      this.logger.warn('tool call failed', { tool: this.name, ...errorFields(err) });
      return new ToolResultBlock({
        toolUseId,
        status: 'error',
        content: [new TextBlock('The tool could not complete the request.')],
      });
    }
  }
}

/** `onUnauthorized` is set with account linking only: a 401 then means the user must link. */
export function mcpTools(
  definitions: McpToolDefinition[],
  client: BridgeMcpClient,
  logger: Logger,
  onUnauthorized?: () => void,
  hidden?: HiddenArguments,
  resultField?: ResultField,
  widgets?: WidgetRecorder,
): Tool[] {
  return definitions.map(
    (d) => new BridgeMcpTool(d, client, logger, onUnauthorized, hidden, resultField, widgets),
  );
}

const askUserInput = z.object({
  message: z.string().describe('The question to speak, one short sentence.'),
  expects: questionExpectsSchema.describe(
    'What kind of answer to listen for: yesNo, date, number, choice, or text.',
  ),
  choices: z.array(z.string()).optional().describe('The options, when expects is choice.'),
});

/**
 * The agent's own way to ask for a missing argument (plan D4). Parks the agent loop on the
 * question queue exactly like an MCP elicitation, so the frontend sees one kind of question.
 */
export function askUserTool(queue: QuestionQueue): Tool {
  return tool({
    name: 'ask_user',
    description: loadPrompt('ask-user').trim(),
    inputSchema: askUserInput,
    callback: async (input) => {
      const answer = await queue.askUser(input);
      return answer.answered
        ? { answer: answer.text }
        : { answered: false, note: 'The user did not answer. Do not ask again.' };
    },
  });
}
