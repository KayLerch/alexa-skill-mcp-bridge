import {
  Agent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeToolCallEvent,
  SlidingWindowConversationManager,
  type MessageData,
  type Model,
  type Tool,
} from '@strands-agents/sdk';
import type { Logger, ToolCallDebug } from '@alexa-mcp-bridge/core';

/** Per-turn debug accumulator, filled by hooks, attached to TurnOutput.debug. */
export interface DebugSink {
  toolCalls: ToolCallDebug[];
  modelCalls: number;
}

export interface BuildAgentOptions {
  model: Model;
  tools: Tool[];
  systemPrompt: string;
  /** Rehydrated history from memory, oldest first. */
  messages?: MessageData[];
  /** The sink of the run in progress, if any. Hooks are registered once; runs come and go. */
  debugSink: () => DebugSink | undefined;
  /** Log tool arguments (only when features.debug is on; arguments may carry user data). */
  logToolArguments: boolean;
  logger: Logger;
}

/** Keep enough history for a conversation, not enough to blow the budget on input tokens. */
const HISTORY_WINDOW = 40;

export function buildAgent(options: BuildAgentOptions): Agent {
  const { logger } = options;
  const agent = new Agent({
    model: options.model,
    tools: options.tools,
    systemPrompt: options.systemPrompt,
    ...(options.messages?.length ? { messages: options.messages } : {}),
    printer: false,
    conversationManager: new SlidingWindowConversationManager({ windowSize: HISTORY_WINDOW }),
    toolExecutor: 'sequential',
  });

  const started = new Map<string, number>();
  agent.addHook(BeforeToolCallEvent, (event) => {
    started.set(event.toolUse.toolUseId, Date.now());
    logger.info('tool call', {
      tool: event.toolUse.name,
      ...(options.logToolArguments ? { input: event.toolUse.input } : {}),
    });
  });
  agent.addHook(AfterToolCallEvent, (event) => {
    const elapsedMs = Date.now() - (started.get(event.toolUse.toolUseId) ?? Date.now());
    started.delete(event.toolUse.toolUseId);
    logger.info('tool result', {
      tool: event.toolUse.name,
      status: event.result.status,
      elapsedMs,
    });
    options.debugSink()?.toolCalls.push({
      name: event.toolUse.name,
      ...(options.logToolArguments ? { input: event.toolUse.input } : {}),
      status: event.result.status,
      elapsedMs,
    });
  });
  agent.addHook(AfterModelCallEvent, () => {
    const sink = options.debugSink();
    if (sink) sink.modelCalls += 1;
  });

  return agent;
}
