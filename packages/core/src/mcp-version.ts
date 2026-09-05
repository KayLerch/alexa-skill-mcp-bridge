/**
 * MCP protocol versions are ISO dates, so plain string comparison orders them.
 *
 * The bridge sets no floor of its own. It speaks whatever the MCP SDK negotiates at
 * `initialize`, and the SDK refuses versions it cannot handle: that is the only technical
 * limit there is. Alexa+ add-ons do have a floor, 2025-11-25, the first version with
 * form-mode elicitation on the open `tools/call` stream. A server below it is still worth
 * testing here, so the bridge warns and carries on instead of refusing.
 */
export const ALEXA_PLUS_PROTOCOL_VERSION = '2025-11-25';

export class ProtocolVersionError extends Error {
  override readonly name = 'ProtocolVersionError';
}

/** The negotiated version. Throws only when the server reported none at all. */
export function requireProtocolVersion(negotiated: string | undefined): string {
  if (!negotiated) {
    throw new ProtocolVersionError(
      'The MCP server did not report a protocol version after initialize.',
    );
  }
  return negotiated;
}

/**
 * One line for servers below the Alexa+ floor, or undefined when there is nothing to say.
 * Callers log it. Nothing here refuses the server.
 */
export function alexaPlusVersionWarning(negotiated: string): string | undefined {
  if (negotiated >= ALEXA_PLUS_PROTOCOL_VERSION) return undefined;
  return (
    `This server negotiated MCP ${negotiated}, so it would not be supported as an Alexa+ add-on: ` +
    `those need ${ALEXA_PLUS_PROTOCOL_VERSION} or later, the latest known floor. The bridge runs ` +
    'against it anyway, but elicitation may behave differently here than on a device.'
  );
}
