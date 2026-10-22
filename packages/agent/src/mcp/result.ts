import { z } from 'zod';

/**
 * The parts of a tools/call result the bridge reads. Loose on purpose: servers add fields.
 * `_meta.ui.resourceUri` names the result's MCP Apps widget, which the agent renders for a
 * device with a screen (D54); the whole result is what the widget is handed.
 */
export const mcpToolResultSchema = z.looseObject({
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
  _meta: z
    .looseObject({
      ui: z.looseObject({ resourceUri: z.string().optional() }).optional(),
    })
    .optional(),
});
export type McpToolResult = z.infer<typeof mcpToolResultSchema>;

export function parseToolResult(raw: unknown): McpToolResult {
  const parsed = mcpToolResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Malformed tools/call result: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

export function toolResultText(result: McpToolResult): string {
  return result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
    .trim();
}
