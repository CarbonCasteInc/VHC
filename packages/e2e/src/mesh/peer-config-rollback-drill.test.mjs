import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateMeshWssComposeText } from './peer-config-rollback-drill.mjs';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '../../../..');
const composePath = path.join(repoRoot, 'infra/docker/docker-compose.mesh-wss.yml');

describe('validateMeshWssComposeText', () => {
  it('accepts the checked-in mesh WSS compose structure', () => {
    const result = validateMeshWssComposeText(fs.readFileSync(composePath, 'utf8'));

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects compose text missing required public relay auth controls', () => {
    const compose = fs
      .readFileSync(composePath, 'utf8')
      .replaceAll('VH_RELAY_AUTH_REQUIRED: "true"', 'VH_RELAY_AUTH_REQUIRED: "false"')
      .replaceAll('VH_RELAY_PEER_ALLOWLIST:', 'VH_RELAY_PEER_ALLOWLIST_DISABLED:');

    const result = validateMeshWssComposeText(compose);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('missing compose fragment VH_RELAY_AUTH_REQUIRED: "true"');
    expect(result.failures).toContain('missing compose fragment VH_RELAY_PEER_ALLOWLIST:');
  });

  it('rejects compose text missing one of the required public relay services', () => {
    const compose = fs
      .readFileSync(composePath, 'utf8')
      .replace('\n  relay-c:\n', '\n  relay-c-disabled:\n');

    const result = validateMeshWssComposeText(compose);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('missing relay-c service');
  });
});
