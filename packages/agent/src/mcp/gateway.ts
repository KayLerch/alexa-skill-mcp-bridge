import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * AgentCore Gateway front: the same Streamable HTTP client, with every request signed
 * with SigV4 for the bedrock-agentcore service. Used when features.gateway is on and the
 * stack passed MCP_GATEWAY_URL. The parked-stream elicitation path is unchanged; whether the
 * Gateway relays server-to-client requests on the stream is verified in Phase 6.
 */
export function sigV4Fetch(region: string): FetchLike {
  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  return async (input, init) => {
    const url = new URL(input);
    const headers: Record<string, string> = { host: url.host };
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const request = new HttpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      method: init?.method ?? 'GET',
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    const signed = await signer.sign(request);
    return fetch(url, { ...init, headers: signed.headers });
  };
}
