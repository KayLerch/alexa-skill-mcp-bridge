import { describe, expect, it } from 'vitest';
import { parseWidgetResource } from './resource.js';

/** The widget resource edge (D54): HTML as text or a base64 blob, nothing else. */

const uri = 'ui://server/widget.html';

describe('parseWidgetResource', () => {
  it('takes the HTML text of an MCP Apps resource', () => {
    const raw = { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: '<p>hi</p>' }] };
    expect(parseWidgetResource(raw, uri)).toBe('<p>hi</p>');
  });

  it('decodes a base64 blob', () => {
    const blob = Buffer.from('<p>blob</p>').toString('base64');
    expect(parseWidgetResource({ contents: [{ uri, mimeType: 'text/html', blob }] }, uri)).toBe(
      '<p>blob</p>',
    );
  });

  it('refuses anything that is not an HTML document', () => {
    expect(() =>
      parseWidgetResource({ contents: [{ uri, mimeType: 'image/png', blob: 'AAAA' }] }, uri),
    ).toThrow(/not an HTML widget/);
    expect(() => parseWidgetResource({ contents: [] }, uri)).toThrow(/Malformed/);
    expect(() => parseWidgetResource({ contents: [{ uri }] }, uri)).toThrow(/no content/);
  });
});
