import { createHash } from 'node:crypto';

/**
 * Hash a raw frontend identifier before it reaches AWS or any log.
 * SHA-256 hex: 64 characters, no dots, which satisfies AgentCore's runtimeSessionId rules.
 */
export function hashId(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
