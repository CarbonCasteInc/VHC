/**
 * Dev-only invite bypass module.
 *
 * Provides explicit test invite codes that bypass normal invite validation
 * when running in development/E2E mode. Production builds reject all
 * dev-bypass codes.
 *
 * @module devInvite
 */

// ── Environment detection ──────────────────────────────────────────

let _devModeOverride: boolean | null = null;

/** Override dev-mode detection for testing. Pass null to restore. */
export function _setDevModeForTesting(value: boolean | null): void {
  _devModeOverride = value;
}

/** Returns true when the app is in development or E2E mode. */
export function isDevMode(): boolean {
  if (_devModeOverride !== null) return _devModeOverride;
  try {
    const env = (
      import.meta as unknown as Record<string, Record<string, unknown>>
    ).env;
    return (
      env?.VITE_E2E_MODE === 'true' ||
      env?.MODE === 'development' ||
      env?.DEV === true
    );
  /* v8 ignore next 3 -- defensive catch for import.meta unavailable */
  } catch {
    return false;
  }
}

// ── Invite code definitions ────────────────────────────────────────

/**
 * Explicit test invite codes. Each maps to a human-readable purpose.
 * These are intentionally NOT secret — they only work in dev mode.
 */
export const DEV_INVITE_CODES: ReadonlyMap<string, string> = new Map([
  ['TRINITY-DEV-001', 'General development bypass'],
  ['TRINITY-TEST-E2E', 'End-to-end test bypass'],
  ['BLDT-SUPER-ADMIN', 'BLDT superuser test account'],
  ['LISA-VOTER-TEST', 'Lisa multi-account vote test'],
  ['LARRY-VOTER-TEST', 'Larry multi-account vote test'],
]);

// ── Validation ─────────────────────────────────────────────────────

export interface InviteValidationResult {
  valid: boolean;
  reason: string;
  isDevBypass: boolean;
}

/**
 * Validate an invite code. Dev-bypass codes are accepted only in dev mode.
 * Returns structured result with validity, reason, and bypass flag.
 */
export function validateInviteCode(code: string): InviteValidationResult {
  const trimmed = code.trim();

  if (!trimmed) {
    return { valid: false, reason: 'Invite code is required', isDevBypass: false };
  }

  const devPurpose = DEV_INVITE_CODES.get(trimmed);

  if (devPurpose !== undefined) {
    if (isDevMode()) {
      return { valid: true, reason: devPurpose, isDevBypass: true };
    }
    return {
      valid: false,
      reason: 'Dev-only invite codes are not accepted in production',
      isDevBypass: false,
    };
  }

  // Non-dev codes: basic format validation (alphanumeric + hyphens, 6-64 chars)
  const FORMAT_RE = /^[A-Za-z0-9-]{6,64}$/;
  if (!FORMAT_RE.test(trimmed)) {
    return {
      valid: false,
      reason: 'Invalid invite code format',
      isDevBypass: false,
    };
  }

  // Valid format but not a known dev code — pass through for upstream validation
  return { valid: true, reason: 'Pending upstream validation', isDevBypass: false };
}

/** List all dev invite codes (for test harness enumeration). */
export function listDevInviteCodes(): ReadonlyArray<[string, string]> {
  return Array.from(DEV_INVITE_CODES.entries());
}
