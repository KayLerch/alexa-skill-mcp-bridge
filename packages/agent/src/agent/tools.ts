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
import type { BridgeMcpClient, McpToolDefinition } from '../mcp/client.js';
import { toolResultText } from '../mcp/result.js';
import type { QuestionQueue } from '../elicitation/queue.js';
import { loadPrompt } from './prompt.js';

/** An MCP tool as a Strands tool. Prefers structuredContent, keeps text, never leaks raw errors. */
export class BridgeMcpTool extends Tool {
  readonly name: string;
  readonly description: string;
  readonly toolSpec: { name: string; description: string; inputSchema: JSONSchema };

  constructor(
    definition: McpToolDefinition,
    private readonly client: BridgeMcpClient,
    private readonly logger: Logger,
  ) {
    super();
    this.name = definition.name;
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
      const result = await this.client.callTool(this.name, args, { signal: context.cancelSignal });
      const content: (JsonBlock | TextBlock)[] = [];
      if (result.structuredContent) {
        content.push(new JsonBlock({ json: result.structuredContent as JSONValue }));
      }
      const text = toolResultText(result);
      if (text) content.push(new TextBlock(text));
      if (content.length === 0) content.push(new TextBlock('The tool returned no content.'));
      if (result._meta?.ui?.resourceUri) {
        // Widgets are out of scope for v1; the hook stays so a visual frontend can pick this up.
        this.logger.debug('tool result carries a ui resource', {
          tool: this.name,
          resourceUri: result._meta.ui.resourceUri,
        });
      }
      return new ToolResultBlock({
        toolUseId,
        status: result.isError ? 'error' : 'success',
        content,
      });
    } catch (err) {
      this.logger.warn('tool call failed', { tool: this.name, ...errorFields(err) });
      return new ToolResultBlock({
        toolUseId,
        status: 'error',
        content: [new TextBlock('The tool could not complete the request.')],
      });
    }
  }
}

export function mcpTools(
  definitions: McpToolDefinition[],
  client: BridgeMcpClient,
  logger: Logger,
): Tool[] {
  return definitions.map((d) => new BridgeMcpTool(d, client, logger));
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
