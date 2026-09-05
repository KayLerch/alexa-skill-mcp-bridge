import { z } from 'zod';

/**
 * The tool manifest: generated from the MCP server, read by the Alexa Skill Lambda.
 * It maps Alexa intents and slots back onto MCP tools and arguments. Data only.
 */

/**
 * No source URL and no timestamp: these files are committed, and the endpoint they were
 * generated from is the developer's business, not the repo's (see the README's security note).
 */
export const generatedMarkerSchema = z.object({
  by: z.string(),
  notice: z.string(),
});
export type GeneratedMarker = z.infer<typeof generatedMarkerSchema>;

export const customSlotTypeSchema = z.object({
  name: z.string(),
  values: z.array(
    z.object({
      value: z.string(),
      id: z.string().optional(),
      synonyms: z.array(z.string()).optional(),
    }),
  ),
});
export type CustomSlotType = z.infer<typeof customSlotTypeSchema>;

export const manifestSlotSchema = z.object({
  /** Property name on the tool's input schema. */
  argument: z.string(),
  /** Alexa slot name (camelCase of the argument). */
  slot: z.string(),
  /** AMAZON.DATE, AMAZON.NUMBER, AMAZON.SearchQuery, YesNoType, or a generated enum type. */
  slotType: z.string(),
  required: z.boolean(),
  /** Present for enum and boolean arguments that need a custom slot type. */
  customType: customSlotTypeSchema.optional(),
});
export type ManifestSlot = z.infer<typeof manifestSlotSchema>;

export const manifestToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** PascalCase(tool.name) + 'Intent'. */
  intent: z.string(),
  slots: z.array(manifestSlotSchema),
  /** Arguments without a slot (for example a second free-text argument). The agent asks for them. */
  elicitedArguments: z.array(z.string()),
  /** Snapshot of the tool's input schema at generate time. */
  inputSchema: z.record(z.string(), z.unknown()),
  /** Set on an extra intent from skill-package/overrides that routes to this tool. */
  aliasOf: z.string().optional(),
});
export type ManifestTool = z.infer<typeof manifestToolSchema>;

export const toolManifestSchema = z.object({
  _generated: generatedMarkerSchema,
  protocolVersion: z.string(),
  server: z.object({
    name: z.string(),
    version: z.string().optional(),
    instructions: z.string().optional(),
  }),
  tools: z.array(manifestToolSchema),
  /** Two example phrases captured at generate time, spoken in the greeting. */
  examplePhrases: z.array(z.string()),
});
export type ToolManifest = z.infer<typeof toolManifestSchema>;

export const GENERATED_BY = 'alexa-skill-mcp-bridge generator';
export const GENERATED_NOTICE = 'Generated file. Do not edit by hand; run `npm run generate`.';
