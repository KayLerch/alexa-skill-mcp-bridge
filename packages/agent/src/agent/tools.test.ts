import { describe, expect, it } from 'vitest';
import type { ToolContext } from '@strands-agents/sdk';
import { createLogger } from '@alexa-mcp-bridge/core';
import type { BridgeMcpClient } from '../mcp/client.js';
import { BridgeMcpTool, HiddenArguments, ResultField, WidgetRecorder } from './tools.js';

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

describe('ResultField (D51)', () => {
  const result = (structuredContent: unknown, isError = false) =>
    Promise.resolve({ content: [], structuredContent, isError });
  const call = async (field: ResultField, reply: Promise<unknown>) => {
    const client = { callTool: () => reply } as unknown as BridgeMcpClient;
    const logger = createLogger({ service: 'test' }, { write: () => undefined });
    const tool = new BridgeMcpTool(definition('t'), client, logger, undefined, undefined, field);
    const context = {
      toolUse: { toolUseId: 't', name: 't', input: {} },
      cancelSignal: new AbortController().signal,
    } as unknown as ToolContext;
    const gen = tool.stream(context);
    let next = await gen.next();
    while (!next.done) next = await gen.next();
  };

  it('keeps the string of the last successful result', async () => {
    const field = new ResultField('say');
    await call(field, result({ say: 'first' }));
    await call(field, result({ say: 'second' }));
    expect(field.value).toBe('second');
  });

  it('ignores error results, non-strings and empty strings', async () => {
    const field = new ResultField('say');
    await call(field, result({ say: 'kept' }));
    await call(field, result({ say: 'from an error' }, true));
    expect(field.value).toBe('kept');
    await call(field, result({ say: 42 }));
    expect(field.value).toBeUndefined();
    await call(field, result({ say: 'back' }));
    await call(field, result({ say: '  ' }));
    expect(field.value).toBeUndefined();
  });

  it('begin() forgets the earlier run', async () => {
    const field = new ResultField('say');
    await call(field, result({ say: 'old' }));
    field.begin();
    expect(field.value).toBeUndefined();
  });
});

describe('WidgetRecorder (D54)', () => {
  const widgetResult = (uri?: string, isError = false) =>
    Promise.resolve({
      content: [],
      structuredContent: { title: 't' },
      isError,
      ...(uri ? { _meta: { ui: { resourceUri: uri } } } : {}),
    });
  const call = async (
    widgets: WidgetRecorder,
    reply: Promise<unknown>,
    declared?: string,
    name = 'show',
  ) => {
    const client = { callTool: () => reply } as unknown as BridgeMcpClient;
    const logger = createLogger({ service: 'test' }, { write: () => undefined });
    const tool = new BridgeMcpTool(
      { ...definition(name), ...(declared ? { uiResourceUri: declared } : {}) },
      client,
      logger,
      undefined,
      undefined,
      undefined,
      widgets,
    );
    const context = {
      toolUse: { toolUseId: 't', name, input: { park: 'yose' } },
      cancelSignal: new AbortController().signal,
    } as unknown as ToolContext;
    const gen = tool.stream(context);
    let next = await gen.next();
    while (!next.done) next = await gen.next();
  };

  it("records the result's widget with the call's input and result", async () => {
    const widgets = new WidgetRecorder();
    await call(widgets, widgetResult('ui://a/one.html'));
    expect(widgets.latest).toMatchObject({
      resourceUri: 'ui://a/one.html',
      toolName: 'show',
      input: { park: 'yose' },
      result: { structuredContent: { title: 't' } },
    });
  });

  it("falls back to the tool's declared widget, ignores errors, and keeps the last widget", async () => {
    const widgets = new WidgetRecorder();
    await call(widgets, widgetResult(), 'ui://a/declared.html');
    expect(widgets.latest?.resourceUri).toBe('ui://a/declared.html');
    await call(widgets, widgetResult('ui://a/two.html', true));
    expect(widgets.latest?.resourceUri).toBe('ui://a/declared.html');
    await call(widgets, widgetResult(), undefined, 'plain');
    expect(widgets.latest?.resourceUri).toBe('ui://a/declared.html');
    widgets.begin();
    expect(widgets.latest).toBeUndefined();
  });
});
