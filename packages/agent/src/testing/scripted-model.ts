import {
  Model,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  type BaseModelConfig,
  type JSONValue,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from '@strands-agents/sdk';

/**
 * A model that plays a script (plan D10). Each step is a tool call or a text answer, or a
 * function that picks one from the conversation so far. Lets the elicitation round trip run
 * in CI without AWS credentials.
 */
export type ScriptStep =
  | { toolUse: { name: string; input: JSONValue } }
  | { text: string }
  | ((messages: Message[]) => ScriptStep);

export class ScriptedModel extends Model<BaseModelConfig> {
  readonly calls: Message[][] = [];
  private cursor = 0;
  private counter = 0;

  constructor(private readonly steps: ScriptStep[]) {
    super();
  }

  updateConfig(): void {}

  getConfig(): BaseModelConfig {
    return { modelId: 'scripted' };
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    this.calls.push(messages);
    let step = this.steps[this.cursor++] ?? { text: 'I have nothing more to add.' };
    while (typeof step === 'function') step = step(messages);
    options?.cancelSignal?.throwIfAborted();

    yield new ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' });
    if ('toolUse' in step) {
      const toolUseId = `scripted-${++this.counter}`;
      yield new ModelContentBlockStartEvent({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: step.toolUse.name, toolUseId },
      });
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: JSON.stringify(step.toolUse.input) },
      });
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
      yield new ModelMessageStopEvent({ type: 'modelMessageStopEvent', stopReason: 'toolUse' });
    } else {
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: step.text },
      });
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
      yield new ModelMessageStopEvent({ type: 'modelMessageStopEvent', stopReason: 'endTurn' });
    }
    yield new ModelMetadataEvent({
      type: 'modelMetadataEvent',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      metrics: { latencyMs: 1 },
    });
  }
}
