import { afterEach, describe, expect, it } from 'vitest';
import {
  _setDevModeForTesting,
  DEV_INVITE_CODES,
  isDevMode,
  listDevInviteCodes,
  validateInviteCode,
} from './devInvite';

describe('devInvite', () => {
  afterEach(() => {
    _setDevModeForTesting(null);
  });

  // ── isDevMode ──────────────────────────────────────────────────

  describe('isDevMode', () => {
    it('returns override value when set to true', () => {
      _setDevModeForTesting(true);
      expect(isDevMode()).toBe(true);
    });

    it('returns override value when set to false', () => {
      _setDevModeForTesting(false);
      expect(isDevMode()).toBe(false);
    });

    it('falls back to env detection when override is null', () => {
      _setDevModeForTesting(null);
      // In test environment, import.meta.env.MODE is typically 'test'
      // which is not 'development', and DEV/E2E flags are not set
      const result = isDevMode();
      expect(typeof result).toBe('boolean');
    });
  });

  // ── DEV_INVITE_CODES ──────────────────────────────────────────

  describe('DEV_INVITE_CODES', () => {
    it('contains exactly 5 codes', () => {
      expect(DEV_INVITE_CODES.size).toBe(5);
    });

    it('includes BLDT superuser code', () => {
      expect(DEV_INVITE_CODES.has('BLDT-SUPER-ADMIN')).toBe(true);
    });

    it('includes Lisa and Larry voter codes', () => {
      expect(DEV_INVITE_CODES.has('LISA-VOTER-TEST')).toBe(true);
      expect(DEV_INVITE_CODES.has('LARRY-VOTER-TEST')).toBe(true);
    });

    it('includes general dev and E2E codes', () => {
      expect(DEV_INVITE_CODES.has('TRINITY-DEV-001')).toBe(true);
      expect(DEV_INVITE_CODES.has('TRINITY-TEST-E2E')).toBe(true);
    });
  });

  // ── validateInviteCode ─────────────────────────────────────────

  describe('validateInviteCode', () => {
    describe('empty/whitespace input', () => {
      it('rejects empty string', () => {
        const result = validateInviteCode('');
        expect(result).toEqual({
          valid: false,
          reason: 'Invite code is required',
          isDevBypass: false,
        });
      });

      it('rejects whitespace-only string', () => {
        const result = validateInviteCode('   ');
        expect(result).toEqual({
          valid: false,
          reason: 'Invite code is required',
          isDevBypass: false,
        });
      });
    });

    describe('dev codes in dev mode', () => {
      it('accepts each dev code with correct purpose', () => {
        _setDevModeForTesting(true);
        for (const [code, purpose] of DEV_INVITE_CODES) {
          const result = validateInviteCode(code);
          expect(result).toEqual({
            valid: true,
            reason: purpose,
            isDevBypass: true,
          });
        }
      });

      it('trims whitespace from code', () => {
        _setDevModeForTesting(true);
        const result = validateInviteCode('  TRINITY-DEV-001  ');
        expect(result.valid).toBe(true);
        expect(result.isDevBypass).toBe(true);
      });
    });

    describe('dev codes in production mode', () => {
      it('rejects dev codes when not in dev mode', () => {
        _setDevModeForTesting(false);
        for (const [code] of DEV_INVITE_CODES) {
          const result = validateInviteCode(code);
          expect(result).toEqual({
            valid: false,
            reason: 'Dev-only invite codes are not accepted in production',
            isDevBypass: false,
          });
        }
      });
    });

    describe('non-dev codes', () => {
      it('passes valid format codes for upstream validation', () => {
        _setDevModeForTesting(false);
        const result = validateInviteCode('ABCDEF-123456');
        expect(result).toEqual({
          valid: true,
          reason: 'Pending upstream validation',
          isDevBypass: false,
        });
      });

      it('accepts 6-char minimum', () => {
        const result = validateInviteCode('ABCDEF');
        expect(result.valid).toBe(true);
        expect(result.isDevBypass).toBe(false);
      });

      it('accepts 64-char maximum', () => {
        const result = validateInviteCode('A'.repeat(64));
        expect(result.valid).toBe(true);
      });

      it('rejects codes shorter than 6 chars', () => {
        const result = validateInviteCode('ABC');
        expect(result).toEqual({
          valid: false,
          reason: 'Invalid invite code format',
          isDevBypass: false,
        });
      });

      it('rejects codes longer than 64 chars', () => {
        const result = validateInviteCode('A'.repeat(65));
        expect(result).toEqual({
          valid: false,
          reason: 'Invalid invite code format',
          isDevBypass: false,
        });
      });

      it('rejects codes with special characters', () => {
        const result = validateInviteCode('ABC@DEF!GH');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Invalid invite code format');
      });

      it('rejects codes with spaces', () => {
        // After trim, "ABC DEF" is 7 chars but contains a space
        const result = validateInviteCode('ABC DEF');
        expect(result.valid).toBe(false);
      });
    });
  });

  // ── listDevInviteCodes ─────────────────────────────────────────

  describe('listDevInviteCodes', () => {
    it('returns all codes as [code, purpose] pairs', () => {
      const list = listDevInviteCodes();
      expect(list).toHaveLength(5);
      expect(list[0]).toEqual(['TRINITY-DEV-001', 'General development bypass']);
    });

    it('returns a fresh array each call', () => {
      const a = listDevInviteCodes();
      const b = listDevInviteCodes();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});
