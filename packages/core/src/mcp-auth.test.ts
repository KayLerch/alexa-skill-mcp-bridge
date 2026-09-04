import { describe, expect, it } from 'vitest';
import { buildAuthHeaders, parseOAuthClientSecret } from './mcp-auth.js';

describe('buildAuthHeaders', () => {
  it('adds nothing for none and oauth', () => {
    expect(buildAuthHeaders({ type: 'none' })).toEqual({});
    expect(buildAuthHeaders({ type: 'oauthClientCredentials', secretName: 's' }, '{}')).toEqual({});
  });

  it('builds bearer and api key headers', () => {
    expect(buildAuthHeaders({ type: 'bearer', secretName: 's' }, 'tok')).toEqual({
      Authorization: 'Bearer tok',
    });
    expect(buildAuthHeaders({ type: 'apiKey', secretName: 's' }, 'k')).toEqual({
      'x-api-key': 'k',
    });
    expect(buildAuthHeaders({ type: 'apiKey', secretName: 's', headerName: 'X-Key' }, 'k')).toEqual(
      {
        'X-Key': 'k',
      },
    );
  });

  it('fails clearly when the secret value is missing', () => {
    expect(() => buildAuthHeaders({ type: 'bearer', secretName: 'my-secret' })).toThrowError(
      /secret name: my-secret/,
    );
  });
});

describe('parseOAuthClientSecret', () => {
  it('parses the JSON shape and rejects others', () => {
    expect(parseOAuthClientSecret('{"clientId":"a","clientSecret":"b"}')).toEqual({
      clientId: 'a',
      clientSecret: 'b',
    });
    expect(() => parseOAuthClientSecret('{"clientId":"a"}')).toThrowError(/clientId.*clientSecret/);
  });
});
