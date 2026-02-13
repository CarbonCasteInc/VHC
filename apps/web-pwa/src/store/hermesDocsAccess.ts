/**
 * HERMES Docs Access Control — pure functions per spec §6.1.
 *
 * Determines access levels and permission checks for HermesDocument.
 * No side effects, no store dependencies — pure logic only.
 */

import type { HermesDocument } from '@vh/data-model';

// ── Types ─────────────────────────────────────────────────────────────

export type DocAccessLevel = 'owner' | 'editor' | 'viewer' | 'none';

// ── Access functions ──────────────────────────────────────────────────

/**
 * Determine access level for a given nullifier on a document.
 */
export function getAccessLevel(doc: HermesDocument, nullifier: string): DocAccessLevel {
  if (doc.owner === nullifier) return 'owner';
  if (doc.collaborators.includes(nullifier)) return 'editor';
  if (doc.viewers?.includes(nullifier)) return 'viewer';
  return 'none';
}

/**
 * Check if a nullifier can edit this document (owner or editor).
 */
export function canEdit(doc: HermesDocument, nullifier: string): boolean {
  const level = getAccessLevel(doc, nullifier);
  return level === 'owner' || level === 'editor';
}

/**
 * Check if a nullifier can view this document (any access except none).
 */
export function canView(doc: HermesDocument, nullifier: string): boolean {
  return getAccessLevel(doc, nullifier) !== 'none';
}

/**
 * Check if a nullifier can share this document (owner only).
 */
export function canShare(doc: HermesDocument, nullifier: string): boolean {
  return doc.owner === nullifier;
}

/**
 * Check if a nullifier can delete this document (owner only).
 */
export function canDelete(doc: HermesDocument, nullifier: string): boolean {
  return doc.owner === nullifier;
}
