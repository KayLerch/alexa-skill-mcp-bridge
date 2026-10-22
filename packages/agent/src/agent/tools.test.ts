import { describe, expect, it } from 'vitest';
import type { ToolContext } from '@strands-agents/sdk';
import { createLogger } from '@alexa-mcp-bridge/core';
import type { BridgeMcpClient } from '../mcp/client.js';
import { BridgeMcpTool, HiddenArguments } from './tools.js';

/** Hidden arguments (D50): a quiz server's session id is refilled from the last result. */

const definition = (name: string) => ({
  name,
  inputSchema: { type: 'object', properties: {} },
});

function setup() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    callTool: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        content: [],
        structuredContent: name === 'start_quiz' ? { session_id: 's1' } : { ok: true },
      });
    },
  } as unknown as BridgeMcpClient;
  const hidden = new HiddenArguments(['session_id']);
  const logger = createLogger({ service: 'test' }, { write: () => undefined });
  const run = async (name: string, input: Record<string, unknown>) => {
    const tool = new BridgeMcpTool(definition(name), client, logger, undefined, hidden);
    const context = {
      toolUse: { toolUseId: 't', name, input },
      cancelSignal: new AbortController().signal,
    } as unknown as ToolContext;
    const gen = tool.stream(context);
    let next = await gen.next();
    while (!next.done) next = await gen.next();
  };
  return { calls, run };
}

describe('BridgeMcpTool hidden arguments', () => {
  it('fills a missing hidden argument from the most recent result that carries it', async () => {
    const { calls, run } = setup();
    await run('start_quiz', {});
    await run('submit_answer', { answer: 'B' });
    expect(calls[1]).toEqual({ name: 'submit_answer', args: { session_id: 's1', answer: 'B' } });
  });

  it('keeps an explicit value from the model', async () => {
    const { calls, run } = setup();
    await run('start_quiz', {});
    await run('submit_answer', { session_id: 'mine', answer: 'B' });
    expect(calls[1]?.args).toEqual({ session_id: 'mine', answer: 'B' });
  });

  it('adds nothing when no result has carried the key yet', async () => {
    const { calls, run } = setup();
    await run('submit_answer', { answer: 'B' });
    expect(calls[0]?.args).toEqual({ answer: 'B' });
  });
});
