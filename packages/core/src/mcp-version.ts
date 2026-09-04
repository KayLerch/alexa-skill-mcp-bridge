/**
 * The bridge needs MCP 2025-11-25 or later: Streamable HTTP with form-mode elicitation
 * delivered on the open tools/call stream. Versions are ISO dates, so strings compare in order.
 */
export const MIN_PROTOCOL_VERSION = '2025-11-25';

export class ProtocolVersionError extends Error {
  override readonly name = 'ProtocolVersionError';
}

export function assertProtocolVersion(negotiated: string | undefined, minimum: string): string {
  if (!negotiated) {
    throw new ProtocolVersionError(
      'The MCP server did not report a protocol version after initialize.',
    );
  }
  if (negotiated < minimum) {
    throw new ProtocolVersionError(
      `The MCP server negotiated protocol ${negotiated}; this bridge needs ${minimum} or later ` +
        '(Streamable HTTP with form-mode elicitation).',
    );
  }
  return negotiated;
}
