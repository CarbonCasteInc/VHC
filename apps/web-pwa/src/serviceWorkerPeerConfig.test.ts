import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SW_PATH = resolve(fileURLToPath(import.meta.url), '../../public/sw.js');

describe('service worker peer-config handling', () => {
  it('keeps mesh peer-config fetches network-only for topology rollover', () => {
    const source = readFileSync(SW_PATH, 'utf8');

    expect(source).toContain('mesh-peer-config');
    expect(source).toContain("fetch(request, { cache: 'no-store' })");
    expect(source).toMatch(/event\.respondWith\(fetch\(request, \{ cache: 'no-store' \}\)\)/);
  });
});
