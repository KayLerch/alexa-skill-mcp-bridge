import { z } from 'zod';

/**
 * A `resources/read` result for an MCP Apps widget (D54): one HTML document, as text or as a
 * base64 blob. The MCP Apps MIME type is `text/html;profile=mcp-app`; any `text/html` passes.
 */
const widgetResourceSchema = z.looseObject({
  contents: z
    .array(
      z.looseObject({
        uri: z.string(),
        mimeType: z.string().optional(),
        text: z.string().optional(),
        blob: z.string().optional(),
      }),
    )
    .min(1),
});

export function parseWidgetResource(raw: unknown, uri: string): string {
  const parsed = widgetResourceSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Malformed resources/read result for ${uri}`);
  const content = parsed.data.contents.find((c) => c.text !== undefined || c.blob !== undefined);
  if (!content) throw new Error(`resources/read for ${uri} returned no content`);
  if (content.mimeType && !content.mimeType.toLowerCase().startsWith('text/html')) {
    throw new Error(`resources/read for ${uri} is ${content.mimeType}, not an HTML widget`);
  }
  return content.text ?? Buffer.from(content.blob ?? '', 'base64').toString('utf8');
}
