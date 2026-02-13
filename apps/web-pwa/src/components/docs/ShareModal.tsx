/**
 * ShareModal — collaborator management with key-sharing.
 *
 * Allows document owner to:
 * - Add/remove collaborators
 * - Select editor/viewer access
 * - Share document key via ECDH (shareDocumentKey/receiveDocumentKey)
 * - Check trust threshold before invite/share actions
 *
 * Feature-gated by parent (only rendered when collab is enabled).
 */

import React, { useCallback, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────

export type AccessRole = 'editor' | 'viewer';

export interface Collaborator {
  nullifier: string;
  role: AccessRole;
  displayName?: string;
}

export interface ShareModalProps {
  docId: string;
  isOpen: boolean;
  onClose: () => void;
  existingCollaborators: Collaborator[];
  ownerNullifier: string;
  /** Trust score of the current user (0-1). */
  trustScore: number;
  /** Minimum trust threshold for sharing (default 0.5). */
  trustThreshold?: number;
  /** Called to share document key with a new collaborator. */
  onShareKey: (
    nullifier: string,
    role: AccessRole,
  ) => Promise<void> | void;
  /** Called to remove a collaborator. */
  onRemove: (nullifier: string) => Promise<void> | void;
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_TRUST_THRESHOLD = 0.5;
const MAX_COLLABORATORS = 10;

// ── Component ─────────────────────────────────────────────────────────

export const ShareModal: React.FC<ShareModalProps> = ({
  docId,
  isOpen,
  onClose,
  existingCollaborators,
  ownerNullifier,
  trustScore,
  trustThreshold = DEFAULT_TRUST_THRESHOLD,
  onShareKey,
  onRemove,
}) => {
  const [newNullifier, setNewNullifier] = useState('');
  const [newRole, setNewRole] = useState<AccessRole>('editor');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trustMet = trustScore >= trustThreshold;
  const atCapacity =
    existingCollaborators.length >= MAX_COLLABORATORS;

  const handleAdd = useCallback(async () => {
    setError(null);

    if (!newNullifier.trim()) {
      setError('Nullifier is required');
      return;
    }

    if (newNullifier.trim() === ownerNullifier) {
      setError('Cannot add yourself as a collaborator');
      return;
    }

    if (
      existingCollaborators.some(
        (c) => c.nullifier === newNullifier.trim(),
      )
    ) {
      setError('Already a collaborator');
      return;
    }

    if (!trustMet) {
      setError(
        `Trust score too low (${trustScore.toFixed(2)} < ${trustThreshold})`,
      );
      return;
    }

    if (atCapacity) {
      setError(`Maximum ${MAX_COLLABORATORS} collaborators reached`);
      return;
    }

    setSharing(true);
    try {
      await onShareKey(newNullifier.trim(), newRole);
      setNewNullifier('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to share key',
      );
    } finally {
      setSharing(false);
    }
  }, [
    newNullifier,
    newRole,
    ownerNullifier,
    existingCollaborators,
    trustMet,
    trustScore,
    trustThreshold,
    atCapacity,
    onShareKey,
  ]);

  const handleRemove = useCallback(
    async (nullifier: string) => {
      try {
        await onRemove(nullifier);
      } catch {
        setError('Failed to remove collaborator');
      }
    },
    [onRemove],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="share-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800"
        data-testid="share-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold" data-testid="share-title">
          Share Document
        </h3>

        {/* Trust warning */}
        {!trustMet && (
          <div
            className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700"
            data-testid="trust-warning"
          >
            Trust score too low to share (
            {trustScore.toFixed(2)} / {trustThreshold} required)
          </div>
        )}

        {/* Add collaborator form */}
        <div className="mb-4 space-y-2">
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Collaborator nullifier"
            value={newNullifier}
            onChange={(e) => setNewNullifier(e.target.value)}
            disabled={sharing || !trustMet}
            data-testid="share-nullifier-input"
          />
          <div className="flex gap-2">
            <select
              className="rounded border px-2 py-1.5 text-sm"
              value={newRole}
              onChange={(e) =>
                setNewRole(e.target.value as AccessRole)
              }
              disabled={sharing || !trustMet}
              data-testid="share-role-select"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              className="rounded bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleAdd}
              disabled={sharing || !trustMet || atCapacity}
              data-testid="share-add-btn"
            >
              {sharing ? 'Sharing…' : 'Add'}
            </button>
          </div>
          {error && (
            <div
              className="text-sm text-red-500"
              data-testid="share-error"
            >
              {error}
            </div>
          )}
        </div>

        {/* Existing collaborators list */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Collaborators ({existingCollaborators.length}/
            {MAX_COLLABORATORS})
          </h4>
          {existingCollaborators.length === 0 && (
            <p
              className="text-sm text-slate-400"
              data-testid="no-collaborators"
            >
              No collaborators yet
            </p>
          )}
          {existingCollaborators.map((c) => (
            <div
              key={c.nullifier}
              className="flex items-center justify-between rounded bg-slate-50 px-3 py-2 dark:bg-slate-700"
              data-testid={`collab-${c.nullifier}`}
            >
              <div>
                <span className="text-sm font-medium">
                  {c.displayName ?? c.nullifier.slice(0, 12)}
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  {c.role}
                </span>
              </div>
              <button
                className="text-xs text-red-500 hover:text-red-700"
                onClick={() => handleRemove(c.nullifier)}
                data-testid={`remove-${c.nullifier}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Close */}
        <div className="mt-4 flex justify-end">
          <button
            className="rounded bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            onClick={onClose}
            data-testid="share-close-btn"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
