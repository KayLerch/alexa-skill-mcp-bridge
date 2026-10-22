import { describe, expect, it, vi } from 'vitest';
import {
  SPOKEN,
  createLogger,
  parseConfig,
  type AgentInvocationInput,
  type BridgeConfig,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import { BridgeClient, UNLINKED_CANCEL_BUDGET_MS } from '../src/bridge.js';
import { launchHandler } from '../src/handlers/launch.js';
import { sessionEndedHandler, stopHandler } from '../src/handlers/standard.js';
import { toolIntentHandler } from '../src/handlers/tool-intent.js';
import { render } from '../src/render.js';
import { handlerInput, manifest, slot } from './helpers.js';

/**
 * mcp.auth.type 'alexaAccountLinking' (D48): the user's own account-linked token travels to the
 * agent on every request; without one the Alexa Skill asks the user to link and never calls the
 * agent. The token never reaches a log line.
 */
const TOKEN = 'Atza|linked-token-0123456789';

const linking = parseConfig({
  mcp: { url: 'https://example.com/mcp', auth: { type: 'alexaAccountLinking' } },
  skill: { invocationName: 'hotel helper' },
  features: { debug: true },
});
const plain = parseConfig({
  mcp: { url: 'https://example.com/mcp' },
  skill: { invocationName: 'hotel helper' },
});

const done = (speech: string): TurnOutput => ({
  status: 'done',
  speech,
  endSession: false,
  visual: null,
});

function harness(
  config: BridgeConfig,
  reply: (envelope: AgentInvocationInput) => Promise<TurnOutput> = async () => done('Hi.'),
) {
  const lines: string[] = [];
  const logger = createLogger({}, { level: 'debug', write: (line) => lines.push(line) });
  const envelopes: AgentInvocationInput[] = [];
  const invoke = vi.fn(async (envelope: AgentInvocationInput) => {
    envelopes.push(envelope);
    return reply(envelope);
  });
  const bridge = new BridgeClient({ config, runtimeArn: 'arn:test', logger, invoke });
  return { bridge, invoke, envelopes, lines };
}

const searchHotels = (accessToken?: string) =>
  handlerInput({
    intent: 'SearchHotelsIntent',
    slots: { destination: slot('destination', 'Berlin') },
    ...(accessToken ? { accessToken } : {}),
  });

describe('account linking in the Alexa Skill Lambda', () => {
  it('asks the user to link, with the LinkAccount card, without a token; the agent only hears a cancel', async () => {
    const { bridge, envelopes } = harness(linking);
    const launch = await launchHandler(bridge, linking, manifest).handle(handlerInput());
    const request = await toolIntentHandler(bridge, manifest).handle(searchHotels());
    for (const response of [launch, request]) {
      expect(response.card).toEqual({ type: 'LinkAccount' });
      expect(response.outputSpeech).toEqual({
        type: 'SSML',
        ssml: `<speak>${SPOKEN.linkAccount}</speak>`,
      });
      expect(response.shouldEndSession).toBe(true);
    }
    // The agent learns the user is unlinked (and drops its history), never with a token.
    expect(envelopes.map((e) => e.turn.type)).toEqual(['cancel', 'cancel']);
    expect(envelopes.every((e) => e.userToken === undefined)).toBe(true);
  });

  it('answers the same when the unlinked cancel fails or hangs', async () => {
    const failing = harness(linking, async () => {
      throw new Error('agent runtime returned 500');
    });
    const hanging = new BridgeClient({
      config: { ...linking, turn: { budgetMs: 1000, progressiveAfterMs: 0 } },
      runtimeArn: 'arn:test',
      logger: createLogger({}, { write: () => undefined }),
      invoke: (_e, _s, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    });
    for (const bridge of [failing.bridge, hanging]) {
      const response = await toolIntentHandler(bridge, manifest).handle(searchHotels());
      expect(response.card).toEqual({ type: 'LinkAccount' });
      expect(response.outputSpeech).toEqual({
        type: 'SSML',
        ssml: `<speak>${SPOKEN.linkAccount}</speak>`,
      });
      expect(response.shouldEndSession).toBe(true);
      expect(response.reprompt).toBeUndefined();
    }
  });

  it('waits on the unlinked cancel only for its own short budget, not the whole turn', async () => {
    vi.useFakeTimers();
    try {
      const budgets: number[] = [];
      let aborted = false;
      const slow = new BridgeClient({
        config: linking,
        runtimeArn: 'arn:test',
        logger: createLogger({}, { write: () => undefined }),
        // A cold agent: answers the cancel only after 5 s, unless the bridge stops waiting first.
        invoke: (envelope, _s, signal) =>
          new Promise((resolve, reject) => {
            budgets.push(envelope.budgetMs);
            const timer = setTimeout(() => resolve(done('')), 5000);
            signal.addEventListener('abort', () => {
              aborted = true;
              clearTimeout(timer);
              reject(new Error('aborted'));
            });
          }),
      });
      let settled = false;
      const response = Promise.resolve(
        toolIntentHandler(slow, manifest).handle(searchHotels()),
      ).then((r) => {
        settled = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(UNLINKED_CANCEL_BUDGET_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBe(true);
      expect(aborted).toBe(true);
      expect(UNLINKED_CANCEL_BUDGET_MS).toBeLessThan(linking.turn.budgetMs);
      expect(budgets).toEqual([UNLINKED_CANCEL_BUDGET_MS]);
      expect((await response).card).toEqual({ type: 'LinkAccount' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('still says goodbye on stop without a token, without the card; the cancel goes out without one', async () => {
    const { bridge, envelopes } = harness(linking);
    const response = await stopHandler(bridge).handle(
      handlerInput({ intent: 'AMAZON.StopIntent' }),
    );
    expect(response.outputSpeech).toEqual({
      type: 'SSML',
      ssml: `<speak>${SPOKEN.goodbye}</speak>`,
    });
    expect(response.card).toBeUndefined();
    expect(envelopes.map((e) => [e.turn.type, e.userToken])).toEqual([['cancel', undefined]]);
    const ended = await sessionEndedHandler(
      bridge,
      createLogger({}, { write: () => undefined }),
    ).handle(handlerInput({ type: 'SessionEndedRequest' }));
    expect(ended.card).toBeUndefined();
    expect(ended.outputSpeech).toBeUndefined();
  });

  it('forwards the token on every envelope, warm-up included', async () => {
    const { bridge, envelopes } = harness(linking);
    const launch = await launchHandler(bridge, linking, manifest).handle(
      handlerInput({ accessToken: TOKEN }),
    );
    expect(launch.card).toBeUndefined();
    await toolIntentHandler(bridge, manifest).handle(searchHotels(TOKEN));
    expect(envelopes.map((e) => e.turn.type)).toEqual(['warmup', 'turn']);
    expect(envelopes.map((e) => e.userToken)).toEqual([TOKEN, TOKEN]);
  });

  it('forwards the token on the poll that fetches an outstanding result, too', async () => {
    const { bridge, envelopes } = harness(linking);
    const input = handlerInput({
      intent: 'SearchHotelsIntent',
      slots: { destination: slot('destination', 'Berlin') },
      sessionAttributes: { awaitingResult: true },
      accessToken: TOKEN,
    });
    await toolIntentHandler(bridge, manifest).handle(input);
    expect(envelopes.map((e) => [e.turn.type, e.userToken])).toEqual([
      ['poll', TOKEN],
      ['turn', TOKEN],
    ]);
  });

  it('shows the card when the agent reports that the server refused the token', async () => {
    const { bridge } = harness(linking, async () => ({
      status: 'done',
      speech: SPOKEN.linkAccount,
      endSession: true,
      visual: null,
      linkAccount: true,
    }));
    const response = await toolIntentHandler(bridge, manifest).handle(searchHotels(TOKEN));
    expect(response.card).toEqual({ type: 'LinkAccount' });
    expect(response.shouldEndSession).toBe(true);
  });

  it('never writes the token to a log line, on success, failure, or timeout', async () => {
    let call = 0;
    const { bridge, lines } = harness(linking, async (envelope) => {
      call += 1;
      if (call === 2) throw new Error('agent runtime returned 500');
      return done(`ok ${envelope.turn.type}`);
    });
    const fast = { ...linking, turn: { budgetMs: 1000, progressiveAfterMs: 0 } };
    const slowBridge = new BridgeClient({
      config: fast,
      runtimeArn: 'arn:test',
      logger: createLogger({}, { level: 'debug', write: (line) => lines.push(line) }),
      invoke: (_e, _s, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    });
    await launchHandler(bridge, linking, manifest).handle(handlerInput({ accessToken: TOKEN }));
    await toolIntentHandler(bridge, manifest).handle(searchHotels(TOKEN));
    await toolIntentHandler(slowBridge, manifest).handle(searchHotels(TOKEN));
    await toolIntentHandler(bridge, manifest).handle(searchHotels());
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });

  it('leaves other auth modes alone: no token in the envelope, no link prompt', async () => {
    const { bridge, envelopes } = harness(plain);
    const response = await toolIntentHandler(bridge, manifest).handle(searchHotels(TOKEN));
    expect(response.card).toBeUndefined();
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.userToken).toBeUndefined();
    const unlinked = await toolIntentHandler(bridge, manifest).handle(searchHotels());
    expect(unlinked.card).toBeUndefined();
    expect(envelopes).toHaveLength(2);
  });
});

describe('render', () => {
  it('adds the LinkAccount card only when the output asks for it', () => {
    const linked = render(handlerInput(), {
      status: 'done',
      speech: SPOKEN.linkAccount,
      endSession: true,
      visual: null,
      linkAccount: true,
    });
    expect(linked.card).toEqual({ type: 'LinkAccount' });
    expect(render(handlerInput(), done('Hi.')).card).toBeUndefined();
  });
});
