/* @vitest-environment jsdom */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { safeSetItem, safeGetItem } from '../../utils/safeStorage';
import {
  isInviteOnlyEnabled,
  setKillSwitch,
  clearKillSwitch,
  getKillSwitchState,
  hasInviteAccess,
  grantInviteAccess,
  revokeInviteAccess,
} from './gatingConfig';

beforeEach(() => {
  safeSetItem('vh_invite_kill_switch', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isInviteOnlyEnabled', () => {
  it('defaults to true when no env var or kill switch is set', () => {
    expect(isInviteOnlyEnabled()).toBe(true);
  });

  it('returns false when kill switch is disabled', () => {
    setKillSwitch(false);
    expect(isInviteOnlyEnabled()).toBe(false);
  });

  it('returns true when kill switch is enabled', () => {
    setKillSwitch(true);
    expect(isInviteOnlyEnabled()).toBe(true);
  });

  it('reverts to default after clearKillSwitch', () => {
    setKillSwitch(false);
    expect(isInviteOnlyEnabled()).toBe(false);
    clearKillSwitch();
    expect(isInviteOnlyEnabled()).toBe(true);
  });

  it('returns false when env var VITE_INVITE_ONLY_ENABLED is "false"', () => {
    vi.stubEnv('VITE_INVITE_ONLY_ENABLED', 'false');
    expect(isInviteOnlyEnabled()).toBe(false);
  });

  it('returns false when VITE_E2E_MODE is "true" (E2E bypass)', () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    expect(isInviteOnlyEnabled()).toBe(false);
  });

  it('E2E bypass takes priority over kill switch enabled', () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    setKillSwitch(true);
    expect(isInviteOnlyEnabled()).toBe(false);
  });
});

describe('getKillSwitchState', () => {
  it('returns default when not set', () => {
    expect(getKillSwitchState()).toBe('default');
  });

  it('returns enabled when kill switch is on', () => {
    setKillSwitch(true);
    expect(getKillSwitchState()).toBe('enabled');
  });

  it('returns disabled when kill switch is off', () => {
    setKillSwitch(false);
    expect(getKillSwitchState()).toBe('disabled');
  });

  it('returns default after clear', () => {
    setKillSwitch(true);
    clearKillSwitch();
    expect(getKillSwitchState()).toBe('default');
  });
});

describe('setKillSwitch', () => {
  it('persists enabled state to localStorage', () => {
    setKillSwitch(true);
    expect(safeGetItem('vh_invite_kill_switch')).toBe('enabled');
  });

  it('persists disabled state to localStorage', () => {
    setKillSwitch(false);
    expect(safeGetItem('vh_invite_kill_switch')).toBe('disabled');
  });
});

describe('invite access persistence', () => {
  beforeEach(() => {
    safeSetItem('vh_invite_access_granted', '');
  });

  it('hasInviteAccess returns false when no access stored', () => {
    expect(hasInviteAccess()).toBe(false);
  });

  it('hasInviteAccess returns true after grantInviteAccess', () => {
    grantInviteAccess();
    expect(hasInviteAccess()).toBe(true);
    expect(safeGetItem('vh_invite_access_granted')).toBe('granted');
  });

  it('revokeInviteAccess clears access', () => {
    grantInviteAccess();
    expect(hasInviteAccess()).toBe(true);
    revokeInviteAccess();
    expect(hasInviteAccess()).toBe(false);
  });

  it('hasInviteAccess returns false for non-granted values', () => {
    safeSetItem('vh_invite_access_granted', 'something-else');
    expect(hasInviteAccess()).toBe(false);
  });
});
