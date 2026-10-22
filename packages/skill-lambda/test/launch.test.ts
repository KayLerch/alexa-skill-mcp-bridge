import { describe, expect, it } from 'vitest';
import { launchHandler } from '../src/handlers/launch.js';
import { config as baseConfig, handlerInput, manifest } from './helpers.js';
import { LINE, done, fakeBridge, launchConfig, repromptOf, ssmlOf } from './voice.js';

/**
 * The launch tool (D57): with skill.launch the Alexa Skill asks the agent to call that tool
 * directly, speaks its line and keeps the session open unless the result ends it; with nothing to
 * say, the greeting.
 */
describe('the launch tool (D57)', () => {
  it('asks the agent for the tool directly and speaks its line, session open', async () => {
    const { bridge, turns } = fakeBridge(launchConfig, () =>
      done(LINE, { reprompt: 'What would you like?' }),
    );
    const input = handlerInput();
    const response = await launchHandler(bridge, launchConfig, manifest).handle(input);
    expect(turns).toEqual([
      {
        type: 'tool',
        tool: 'suggest_visit',
        arguments: { season: 'spring' },
        intent: 'LaunchRequest',
      },
    ]);
    expect(ssmlOf(response)).toBe(`<speak>${LINE.replace(/"/g, '&quot;')}</speak>`);
    expect(repromptOf(response)).toBe('<speak>What would you like?</speak>');
    expect(response.shouldEndSession).toBe(false);
  });

  it('ends the session when the tool result says so', async () => {
    const { bridge } = fakeBridge(launchConfig, () =>
      done('Nothing saved yet. Goodbye for now.', { endSession: true }),
    );
    const response = await launchHandler(bridge, launchConfig, manifest).handle(handlerInput());
    expect(response.shouldEndSession).toBe(true);
  });

  it('falls back to the greeting when the call gives nothing to say', async () => {
    const { bridge } = fakeBridge(launchConfig, () => done(''));
    const response = await launchHandler(bridge, launchConfig, manifest).handle(handlerInput());
    expect(ssmlOf(response)).toContain('Welcome to hotels and weather');
    expect(response.shouldEndSession).toBe(false);
  });

  it('only warms up without skill.launch', async () => {
    const { bridge, turns } = fakeBridge(baseConfig, () => done(''));
    await launchHandler(bridge, baseConfig, manifest).handle(handlerInput());
    expect(turns).toEqual([{ type: 'warmup' }]);
  });

  it('does not poll an outstanding result first: the agent drops the old run itself', async () => {
    const { bridge, turns } = fakeBridge(launchConfig, () => done(LINE));
    await bridge.turn(
      handlerInput({ intent: 'AMAZON.NextIntent', sessionAttributes: { awaitingResult: true } }),
      { type: 'tool', tool: 'skip_question', intent: 'AMAZON.NextIntent' },
    );
    expect(turns.map((t) => t.type)).toEqual(['tool']);
  });
});
