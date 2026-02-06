import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const INDEX_HTML_PATH = resolve(process.cwd(), 'apps/web-pwa/index.html');
const REQUIRED_DIRECTIVES = [
  'default-src',
  'script-src',
  'style-src',
  'connect-src',
  'img-src',
  'worker-src',
  'object-src',
  'base-uri',
  'form-action'
] as const;

function getCspContent(html: string): string {
  const metaTagMatch = html.match(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  if (!metaTagMatch) return '';

  const contentMatch = metaTagMatch[0].match(/content=(["'])(.*?)\1/i);
  return contentMatch?.[2] ?? '';
}

function parseDirectives(csp: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const directive of csp.split(';').map((entry) => entry.trim()).filter(Boolean)) {
    const [name, ...values] = directive.split(/\s+/);
    directives.set(name, values.join(' '));
  }
  return directives;
}

describe('index.html content security policy', () => {
  it('defines required CSP directives and keeps unsafe-inline out of script-src', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf8');
    const csp = getCspContent(html);

    expect(csp).not.toBe('');

    const directives = parseDirectives(csp);

    for (const directive of REQUIRED_DIRECTIVES) {
      expect(directives.has(directive)).toBe(true);
    }

    const scriptSrc = directives.get('script-src') ?? '';
    const styleSrc = directives.get('style-src') ?? '';

    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(styleSrc).toContain("'unsafe-inline'");

    const directivesWithUnsafeInline = [...directives.entries()]
      .filter(([, value]) => value.includes("'unsafe-inline'"))
      .map(([name]) => name);

    expect(directivesWithUnsafeInline).toEqual(['style-src']);
  });
});
