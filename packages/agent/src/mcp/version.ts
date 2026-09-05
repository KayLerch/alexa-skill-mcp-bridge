/**
 * Protocol version switch. 2025-11-25 delivers elicitation on the open tools/call stream,
 * which the bridge parks between turns. 2026-07-28 adds stateless multi-round-trip
 * elicitation; it is out of scope for v1 and would plug in here.
 *
 * Older servers are not refused: the SDK decides what it can speak, and anything below the
 * Alexa+ floor only earns a warning (see core/mcp-version.ts).
 */
export {
  ALEXA_PLUS_PROTOCOL_VERSION,
  ProtocolVersionError,
  requireProtocolVersion,
  alexaPlusVersionWarning,
} from '@alexa-mcp-bridge/core';

export type ElicitationTransport = 'parked-stream';

export function elicitationTransportFor(_version: string): ElicitationTransport {
  return 'parked-stream';
}
