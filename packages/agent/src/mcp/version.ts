/**
 * Protocol version switch. 2025-11-25 delivers elicitation on the open tools/call stream,
 * which the bridge parks between turns. 2026-07-28 adds stateless multi-round-trip
 * elicitation; it is out of scope for v1 and would plug in here.
 */
export {
  MIN_PROTOCOL_VERSION,
  ProtocolVersionError,
  assertProtocolVersion,
} from '@alexa-mcp-bridge/core';

export type ElicitationTransport = 'parked-stream';

export function elicitationTransportFor(_version: string): ElicitationTransport {
  return 'parked-stream';
}
