import { afterEach, describe, expect, it, vi } from 'vitest';
import { lumaForumDeploymentProfile } from './lumaRecords';

function setForumEnv(env: Record<string, string | boolean | undefined>, e2eOverride?: boolean): void {
  if (typeof e2eOverride === 'boolean') {
    vi.stubGlobal('__VH_E2E_OVERRIDE__', e2eOverride);
  }
  vi.stubGlobal('__VH_IMPORT_META_ENV__', {
    VITE_E2E_MODE: 'false',
    MODE: 'production',
    VITEST: 'false',
    DEV: false,
    ...env,
  });
}

describe('lumaForumDeploymentProfile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves explicit E2E override before configured LUMA profiles', () => {
    setForumEnv({ VITE_LUMA_PROFILE: 'public-beta' }, true);

    expect(lumaForumDeploymentProfile()).toBe('e2e');
  });

  it('resolves configured public-beta and production-attestation profiles outside E2E', () => {
    setForumEnv({ VITE_LUMA_PROFILE: 'public-beta' }, false);
    expect(lumaForumDeploymentProfile()).toBe('public-beta');

    setForumEnv({ VITE_LUMA_PROFILE: 'production-attestation' }, false);
    expect(lumaForumDeploymentProfile()).toBe('production-attestation');
  });

  it('keeps dev and fallback profile behavior deterministic', () => {
    setForumEnv({ DEV: true }, false);
    expect(lumaForumDeploymentProfile()).toBe('dev');

    setForumEnv({ MODE: 'development' }, false);
    expect(lumaForumDeploymentProfile()).toBe('dev');

    setForumEnv({ VITE_LUMA_PROFILE: 'unsupported' }, false);
    expect(lumaForumDeploymentProfile()).toBe('public-beta');
  });
});
