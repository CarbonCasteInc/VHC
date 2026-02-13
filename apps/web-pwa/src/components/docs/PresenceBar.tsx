/**
 * PresenceBar — collaborator cursors/presence indicators.
 *
 * Renders a list of online collaborators from AwarenessAdapter state.
 * Each peer shows a colored dot, display name, and optional cursor position.
 */

import React from 'react';
import type { CollabPeer } from '../../store/hermesDocsCollab';

// ── Types ─────────────────────────────────────────────────────────────

export interface PresenceBarProps {
  peers: Map<number, CollabPeer>;
  myNullifier: string;
}

// ── Default colors for peers without explicit color ───────────────────

const PALETTE = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b',
  '#8b5cf6', '#ef4444', '#22c55e', '#3b82f6',
];

function colorFor(index: number, explicit?: string): string {
  return explicit ?? PALETTE[index % PALETTE.length]!;
}

// ── Component ─────────────────────────────────────────────────────────

export const PresenceBar: React.FC<PresenceBarProps> = ({
  peers,
  myNullifier,
}) => {
  const entries = Array.from(peers.entries()).filter(
    ([, peer]) => peer.nullifier !== myNullifier,
  );

  if (entries.length === 0) return null;

  return (
    <div
      className="mb-2 flex flex-wrap gap-2"
      data-testid="presence-bar"
    >
      {entries.map(([clientId, peer], idx) => (
        <div
          key={clientId}
          className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800"
          data-testid={`peer-${clientId}`}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: colorFor(idx, peer.color) }}
          />
          <span>{peer.displayName ?? peer.nullifier.slice(0, 8)}</span>
          {peer.cursor && (
            <span className="text-slate-400" data-testid={`cursor-${clientId}`}>
              ✎
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
