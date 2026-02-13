import { describe, expect, it } from 'vitest';
import {
  getAccessLevel,
  canEdit,
  canView,
  canShare,
  canDelete,
  type DocAccessLevel,
} from './hermesDocsAccess';
import type { HermesDocument } from '@vh/data-model';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeDoc(overrides?: Partial<HermesDocument>): HermesDocument {
  return {
    id: 'doc-1',
    schemaVersion: 'hermes-document-v0',
    title: 'Test',
    type: 'article',
    owner: 'owner-null',
    collaborators: ['editor-null'],
    encryptedContent: 'content',
    createdAt: 1_700_000_000_000,
    lastModifiedAt: 1_700_000_000_000,
    lastModifiedBy: 'owner-null',
    viewers: ['viewer-null'],
    ...overrides,
  } as HermesDocument;
}

// ── getAccessLevel ────────────────────────────────────────────────────

describe('getAccessLevel', () => {
  it('returns "owner" for the document owner', () => {
    expect(getAccessLevel(makeDoc(), 'owner-null')).toBe('owner');
  });

  it('returns "editor" for a collaborator', () => {
    expect(getAccessLevel(makeDoc(), 'editor-null')).toBe('editor');
  });

  it('returns "viewer" for a viewer', () => {
    expect(getAccessLevel(makeDoc(), 'viewer-null')).toBe('viewer');
  });

  it('returns "none" for an unknown nullifier', () => {
    expect(getAccessLevel(makeDoc(), 'stranger')).toBe('none');
  });

  it('returns "none" when viewers is undefined', () => {
    const doc = makeDoc({ viewers: undefined });
    expect(getAccessLevel(doc, 'viewer-null')).toBe('none');
  });

  it('prioritizes owner over collaborator', () => {
    const doc = makeDoc({ collaborators: ['owner-null'] });
    expect(getAccessLevel(doc, 'owner-null')).toBe('owner');
  });

  it('prioritizes collaborator over viewer', () => {
    const doc = makeDoc({
      collaborators: ['dual-null'],
      viewers: ['dual-null'],
    });
    expect(getAccessLevel(doc, 'dual-null')).toBe('editor');
  });
});

// ── canEdit ───────────────────────────────────────────────────────────

describe('canEdit', () => {
  it('returns true for owner', () => {
    expect(canEdit(makeDoc(), 'owner-null')).toBe(true);
  });

  it('returns true for editor', () => {
    expect(canEdit(makeDoc(), 'editor-null')).toBe(true);
  });

  it('returns false for viewer', () => {
    expect(canEdit(makeDoc(), 'viewer-null')).toBe(false);
  });

  it('returns false for none', () => {
    expect(canEdit(makeDoc(), 'stranger')).toBe(false);
  });
});

// ── canView ───────────────────────────────────────────────────────────

describe('canView', () => {
  it('returns true for owner', () => {
    expect(canView(makeDoc(), 'owner-null')).toBe(true);
  });

  it('returns true for editor', () => {
    expect(canView(makeDoc(), 'editor-null')).toBe(true);
  });

  it('returns true for viewer', () => {
    expect(canView(makeDoc(), 'viewer-null')).toBe(true);
  });

  it('returns false for none', () => {
    expect(canView(makeDoc(), 'stranger')).toBe(false);
  });
});

// ── canShare ──────────────────────────────────────────────────────────

describe('canShare', () => {
  it('returns true for owner', () => {
    expect(canShare(makeDoc(), 'owner-null')).toBe(true);
  });

  it('returns false for editor', () => {
    expect(canShare(makeDoc(), 'editor-null')).toBe(false);
  });

  it('returns false for viewer', () => {
    expect(canShare(makeDoc(), 'viewer-null')).toBe(false);
  });

  it('returns false for none', () => {
    expect(canShare(makeDoc(), 'stranger')).toBe(false);
  });
});

// ── canDelete ─────────────────────────────────────────────────────────

describe('canDelete', () => {
  it('returns true for owner', () => {
    expect(canDelete(makeDoc(), 'owner-null')).toBe(true);
  });

  it('returns false for editor', () => {
    expect(canDelete(makeDoc(), 'editor-null')).toBe(false);
  });

  it('returns false for viewer', () => {
    expect(canDelete(makeDoc(), 'viewer-null')).toBe(false);
  });

  it('returns false for none', () => {
    expect(canDelete(makeDoc(), 'stranger')).toBe(false);
  });
});
