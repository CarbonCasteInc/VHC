/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMode, resolveE2E, useEditorMode } from './useEditorMode';

// Mock localStorage for loadDocumentKey
const mockStorage: Record<string, string> = {};
beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
    (key: string) => mockStorage[key] ?? null,
  );
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
    (key: string, val: string) => { mockStorage[key] = val; },
  );
});
afterEach(() => vi.restoreAllMocks());

// ── resolveMode ───────────────────────────────────────────────────────

describe('resolveMode', () => {
  it('returns textarea when both flags false', () => {
    expect(resolveMode(false, false)).toBe('textarea');
  });

  it('returns textarea when docs on but collab off', () => {
    expect(resolveMode(true, false)).toBe('textarea');
  });

  it('returns textarea when docs off but collab on', () => {
    expect(resolveMode(false, true)).toBe('textarea');
  });

  it('returns collab when both flags true', () => {
    expect(resolveMode(true, true)).toBe('collab');
  });

  it('falls back to env flags when args undefined', () => {
    // Env flags are not set in test → both false → textarea
    expect(resolveMode()).toBe('textarea');
  });
});

// ── resolveE2E ────────────────────────────────────────────────────────

describe('resolveE2E', () => {
  it('returns override when provided', () => {
    expect(resolveE2E(true)).toBe(true);
    expect(resolveE2E(false)).toBe(false);
  });

  it('falls back to env flag when undefined', () => {
    // VITE_E2E_MODE not set in test → false
    expect(resolveE2E()).toBe(false);
  });
});

// ── useEditorMode ─────────────────────────────────────────────────────

describe('useEditorMode', () => {
  const baseOpts = {
    docId: 'doc-123',
    myNullifier: 'user-abc',
    displayName: 'Alice',
    color: '#ff0000',
    collaborators: ['peer-1', 'peer-2'],
  };

  describe('textarea mode (flag off)', () => {
    it('returns textarea mode when collab flag off', () => {
      const result = useEditorMode({
        ...baseOpts,
        _docsEnabled: true,
        _collabEnabled: false,
      });
      expect(result.mode).toBe('textarea');
      expect(result.collabProps).toBeNull();
    });

    it('returns textarea mode when docs flag off', () => {
      const result = useEditorMode({
        ...baseOpts,
        _docsEnabled: false,
        _collabEnabled: true,
      });
      expect(result.mode).toBe('textarea');
      expect(result.collabProps).toBeNull();
    });

    it('returns textarea when both flags off', () => {
      const result = useEditorMode({
        ...baseOpts,
        _docsEnabled: false,
        _collabEnabled: false,
      });
      expect(result.mode).toBe('textarea');
      expect(result.collabProps).toBeNull();
    });

    it('returns textarea even if doc has collaborators when flag off', () => {
      const result = useEditorMode({
        ...baseOpts,
        collaborators: ['collab-a', 'collab-b'],
        _docsEnabled: true,
        _collabEnabled: false,
      });
      expect(result.mode).toBe('textarea');
      expect(result.collabProps).toBeNull();
    });
  });

  describe('collab mode (both flags on)', () => {
    it('returns collab mode with resolved props', () => {
      const result = useEditorMode({
        ...baseOpts,
        _docsEnabled: true,
        _collabEnabled: true,
        _e2eMode: true,
      });
      expect(result.mode).toBe('collab');
      expect(result.collabProps).not.toBeNull();
      expect(result.collabProps!.docId).toBe('doc-123');
      expect(result.collabProps!.myNullifier).toBe('user-abc');
      expect(result.collabProps!.displayName).toBe('Alice');
      expect(result.collabProps!.color).toBe('#ff0000');
      expect(result.collabProps!.collaborators).toEqual(['peer-1', 'peer-2']);
      expect(result.collabProps!.e2eMode).toBe(true);
    });

    it('resolves documentKey from localStorage cache', () => {
      mockStorage['vh_docs_keys:user-abc'] = JSON.stringify({ 'doc-123': 'cached-key' });
      const result = useEditorMode({
        ...baseOpts,
        _docsEnabled: true,
        _collabEnabled: true,
        _e2eMode: false,
      });
      expect(result.collabProps!.documentKey).toBe('cached-key');
    });

    it('returns empty documentKey when not cached', () => {
      const result = useEditorMode({
        ...baseOpts,
        _docsEnabled: true,
        _collabEnabled: true,
        _e2eMode: false,
      });
      expect(result.collabProps!.documentKey).toBe('');
    });

    it('falls back to textarea when docId is null', () => {
      const result = useEditorMode({
        ...baseOpts,
        docId: null,
        _docsEnabled: true,
        _collabEnabled: true,
      });
      expect(result.mode).toBe('textarea');
      expect(result.collabProps).toBeNull();
    });

    it('passes onAutoSave through to collab props', () => {
      const autoSave = vi.fn();
      const result = useEditorMode({
        ...baseOpts,
        onAutoSave: autoSave,
        _docsEnabled: true,
        _collabEnabled: true,
        _e2eMode: true,
      });
      expect(result.collabProps!.onAutoSave).toBe(autoSave);
    });

    it('resolves e2eMode from override', () => {
      const r1 = useEditorMode({ ...baseOpts, _docsEnabled: true, _collabEnabled: true, _e2eMode: true });
      expect(r1.collabProps!.e2eMode).toBe(true);
      const r2 = useEditorMode({ ...baseOpts, _docsEnabled: true, _collabEnabled: true, _e2eMode: false });
      expect(r2.collabProps!.e2eMode).toBe(false);
    });
  });
});
