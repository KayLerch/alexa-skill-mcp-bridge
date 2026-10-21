import { describe, expect, it } from 'vitest';
import { SPOKEN } from '@alexa-mcp-bridge/core';
import { launchHandler } from '../src/handlers/launch.js';
import {
  builtInHandler,
  fallbackHandler,
  helpHandler,
  repeatHandler,
  stopHandler,
} from '../src/handlers/standard.js';
import { greeting, helpText } from '../src/greeting.js';
import { config as baseConfig, handlerInput, manifest } from './helpers.js';
import { LINE, done, fakeBridge, launchConfig, repromptOf, ssmlOf, withConfig } from './voice.js';

/**
 * The voice flow around the agent's turns: repeat and mapped built-in intents (D59), a missed
 * answer while the session is open (D60), help and examples from config (D61).
 */
describe('repeat (D59)', () => {
  it('replays what the user heard last without calling the agent', async () => {
    const { bridge, turns } = fakeBridge(launchConfig, () =>
      done(LINE, { reprompt: 'What would you like?' }),
    );
    const input = handlerInput();
    await launchHandler(bridge, launchConfig, manifest).handle(input);
    const attributes = input.attributesManager.getSessionAttributes();
    const repeat = handlerInput({ intent: 'AMAZON.RepeatIntent', sessionAttributes: attributes });
    const response = await repeatHandler().handle(repeat);
    expect(turns).toHaveLength(1);
    expect(ssmlOf(response)).toContain('Welcome back.');
    expect(repromptOf(response)).toBe('<speak>What would you like?</speak>');
    expect(response.shouldEndSession).toBe(false);
    expect(repeat.attributesManager.getSessionAttributes()).toEqual(attributes);
  });

  it('never replays "still working": the last real answer stays', async () => {
    const config = withConfig({});
    const { bridge } = fakeBridge(config, () => ({
      status: 'pending',
      speech: config.skill.stillWorkingMessage,
      reprompt: config.skill.stillWorkingMessage,
      endSession: false,
      visual: null,
    }));
    const input = handlerInput({
      intent: 'AMAZON.NextIntent',
      sessionAttributes: { lastSpeech: 'Which park?', lastReprompt: 'Which park?' },
    });
    await builtInHandler(bridge, config).handle(input);
    expect(input.attributesManager.getSessionAttributes()).toMatchObject({
      lastSpeech: 'Which park?',
    });
  });

  it('a re-ask after a missed answer does not replace what "repeat" replays', async () => {
    const config = withConfig({});
    const { bridge } = fakeBridge(config, () => done(''));
    const input = handlerInput({
      intent: 'AMAZON.FallbackIntent',
      sessionAttributes: { openTurn: true, lastSpeech: 'Which park?', lastReprompt: 'Which park?' },
    });
    await fallbackHandler(bridge, config).handle(input);
    expect(input.attributesManager.getSessionAttributes()).toMatchObject({
      lastSpeech: 'Which park?',
    });
  });
});

describe('mapped built-in intents (D59)', () => {
  const mapped = withConfig({
    intents: {
      builtIns: {
        'AMAZON.NextIntent': { tool: 'skip_question', arguments: { reveal: true } },
        'AMAZON.StartOverIntent': { text: 'start a new trip' },
        'AMAZON.StopIntent': { tool: 'end_trip' },
      },
    },
  });

  it('next calls its tool directly', async () => {
    const { bridge, turns } = fakeBridge(mapped, () => done('Skipped. Which park is next?'));
    const response = await builtInHandler(bridge, mapped).handle(
      handlerInput({ intent: 'AMAZON.NextIntent' }),
    );
    expect(turns).toEqual([
      {
        type: 'tool',
        tool: 'skip_question',
        arguments: { reveal: true },
        intent: 'AMAZON.NextIntent',
      },
    ]);
    expect(ssmlOf(response)).toContain('Skipped.');
  });

  it('a call with nothing to say apologises and asks the last question again', async () => {
    const { bridge } = fakeBridge(mapped, () => done(''));
    const response = await builtInHandler(bridge, mapped).handle(
      handlerInput({
        intent: 'AMAZON.NextIntent',
        sessionAttributes: { lastSpeech: 'Right! Which park?', lastReprompt: 'Which park?' },
      }),
    );
    expect(ssmlOf(response)).toBe(`<speak>${SPOKEN.notDone} Which park?</speak>`);
    expect(response.shouldEndSession).toBe(false);
  });

  it('a text mapping is a turn the agent hears', async () => {
    const { bridge, turns } = fakeBridge(mapped, () => done('Where to?'));
    await builtInHandler(bridge, mapped).handle(handlerInput({ intent: 'AMAZON.StartOverIntent' }));
    expect(turns).toEqual([
      { type: 'turn', utterance: { intent: 'AMAZON.StartOverIntent', text: 'start a new trip' } },
    ]);
  });

  it('an unmapped built-in reaches the agent as the word itself', async () => {
    const { bridge, turns } = fakeBridge(baseConfig, () => done('Next what?'));
    await builtInHandler(bridge, baseConfig).handle(handlerInput({ intent: 'AMAZON.NextIntent' }));
    expect(turns).toEqual([
      { type: 'turn', utterance: { intent: 'AMAZON.NextIntent', text: 'next' } },
    ]);
  });

  it('stop calls its tool, then says goodbye whatever the tool answered', async () => {
    for (const reply of [
      () => done('Trip saved. Want another?'),
      () => ({ status: 'error', speech: SPOKEN.error, endSession: true, visual: null }) as const,
      () => {
        throw new Error('boom');
      },
    ]) {
      const { bridge, turns } = fakeBridge(mapped, reply);
      const response = await stopHandler(bridge, mapped).handle(
        handlerInput({ intent: 'AMAZON.StopIntent' }),
      );
      expect(turns.map((t) => t.type)).toEqual(['tool']);
      expect(ssmlOf(response)).toBe(`<speak>${SPOKEN.goodbye}</speak>`);
      expect(response.shouldEndSession).toBe(true);
    }
  });

  it('cancel without a mapping still sends a cancel', async () => {
    const { bridge, turns } = fakeBridge(mapped, () => done(''));
    await stopHandler(bridge, mapped).handle(handlerInput({ intent: 'AMAZON.CancelIntent' }));
    expect(turns).toEqual([{ type: 'cancel' }]);
  });

  it('refuses a text for a goodbye intent', () => {
    expect(() =>
      withConfig({ intents: { builtIns: { 'AMAZON.StopIntent': { text: 'stop' } } } }),
    ).toThrow(/intents\.builtIns\.AMAZON\.StopIntent/);
  });
});

describe('a missed answer while the session is open (D60)', () => {
  it('says skill.fallbackWhileOpen and the last question, without calling the agent', async () => {
    const config = withConfig({ skill: { fallbackWhileOpen: 'Hmm, I missed that.' } });
    const { bridge, turns } = fakeBridge(config, () => done('What would you like to do?'));
    const response = await fallbackHandler(bridge, config).handle(
      handlerInput({
        intent: 'AMAZON.FallbackIntent',
        sessionAttributes: {
          openTurn: true,
          lastSpeech: 'Right. Next: which park has the tallest trees?',
          lastReprompt: 'Which park has the tallest trees?',
        },
      }),
    );
    expect(turns).toEqual([]);
    expect(ssmlOf(response)).toBe(
      '<speak>Hmm, I missed that. Which park has the tallest trees?</speak>',
    );
    expect(repromptOf(response)).toBe('<speak>Which park has the tallest trees?</speak>');
    expect(response.shouldEndSession).toBe(false);
  });

  it('defaults to "Sorry, I didn\'t catch that."', () => {
    expect(withConfig({}).skill.fallbackWhileOpen).toBe("Sorry, I didn't catch that.");
  });

  it('with a result still being worked on, the agent turn fetches it first', async () => {
    const config = withConfig({});
    const { bridge, turns } = fakeBridge(config, () => done('Here it is. Next?'));
    await fallbackHandler(bridge, config).handle(
      handlerInput({
        intent: 'AMAZON.FallbackIntent',
        sessionAttributes: { openTurn: true, awaitingResult: true, lastSpeech: 'One moment.' },
      }),
    );
    expect(turns.map((t) => t.type)).toEqual(['poll', 'turn']);
  });

  it('without an open turn the agent still asks what was meant', async () => {
    const config = withConfig({});
    const { bridge, turns } = fakeBridge(config, () => done('What would you like to do?'));
    await fallbackHandler(bridge, config).handle(handlerInput({ intent: 'AMAZON.FallbackIntent' }));
    expect(turns).toEqual([{ type: 'turn', utterance: { intent: 'AMAZON.FallbackIntent' } }]);
  });
});

describe('help and examples from config (D61)', () => {
  it('speaks skill.help', async () => {
    const config = withConfig({ skill: { help: 'Say "plan Zion". What would you like?' } });
    expect(helpText(config, manifest)).toBe('Say "plan Zion". What would you like?');
    const response = await helpHandler(config, manifest).handle(
      handlerInput({ intent: 'AMAZON.HelpIntent' }),
    );
    expect(ssmlOf(response)).toContain('Say &quot;plan Zion&quot;.');
  });

  it('greets with skill.examplePhrases instead of the generated ones', () => {
    const config = withConfig({ skill: { examplePhrases: ['plan zion', 'find a quiet park'] } });
    expect(greeting(config, manifest)).toBe(
      'Welcome to hotels and weather. For example, say "plan zion" or "find a quiet park". What would you like to do?',
    );
    expect(helpText(config, manifest)).toContain('"plan zion" or "find a quiet park"');
  });
});
