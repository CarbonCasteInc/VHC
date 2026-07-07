/**
 * RepresentativeSelector — Representative cards per §8.2.
 *
 * Renders name, title, party, office, district, channels, lastVerified.
 * Trust gate: >= 0.5 to view rep list.
 *
 * Read-surface trust gate (reconciled with Slice D1 no-direct-comparison rule):
 * spec-civic-action-kit-v0 §7.1 gates "View rep list" at >= 0.5, but
 * spec-luma-service-v0 §5 says public-mesh *reads* are NOT canPerform-gated —
 * only write-shaped audiences are. So this view gate deliberately does NOT
 * invent a canPerform write action. Instead it routes the §2 threshold decision
 * through `scoreFromEnvelope` (spec-luma-service-v0 §4), the single sanctioned
 * escape hatch from the forbidden direct `trustScore` comparison. The rep list
 * is derived from the *active* constituency proof's district_hash (which binds
 * to the active LUMA nullifier), falling back to the configured district.
 *
 * Spec: spec-civic-action-kit-v0.md §8.2
 */

import React from 'react';
import type { Representative } from '@vh/data-model';
import { TRUST_MINIMUM } from '@vh/data-model';
import { scoreFromEnvelope } from '@vh/luma-sdk';
import { useIdentity } from '../../hooks/useIdentity';
import { useConstituencyProof } from '../../hooks/useConstituencyProof';
import { getConfiguredDistrict } from '../../store/bridge/districtConfig';
import { findRepresentatives } from '../../store/bridge/representativeDirectory';

export interface RepresentativeSelectorProps {
  readonly onSelect: (repId: string) => void;
}

function channelBadges(rep: Representative): string[] {
  const channels: string[] = [];
  if (rep.email) channels.push('email');
  if (rep.phone) channels.push('phone');
  if (rep.contactUrl) channels.push('web');
  if (channels.length === 0) channels.push('manual');
  return channels;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

export const RepresentativeSelector: React.FC<RepresentativeSelectorProps> = ({ onSelect }) => {
  const { identity } = useIdentity();
  const { proof } = useConstituencyProof();
  const viewScore = scoreFromEnvelope(identity?.assuranceEnvelope);

  if (viewScore < TRUST_MINIMUM) {
    return (
      <p data-testid="rep-trust-gate" className="text-sm text-amber-600">
        Trust score ({viewScore.toFixed(2)}) below 0.50 — verify identity to view representatives.
      </p>
    );
  }

  // Prefer the active constituency proof's district_hash — it binds to the
  // active LUMA nullifier — and fall back to the configured district. A wrong
  // or missing district hash yields no matched offices (rep-empty), never a
  // cross-district list.
  const districtHash = proof?.district_hash ?? getConfiguredDistrict();
  const reps = findRepresentatives(districtHash);

  if (reps.length === 0) {
    return (
      <p data-testid="rep-empty" className="text-sm text-gray-500">
        No representatives loaded. Directory will sync when available.
      </p>
    );
  }

  return (
    <div data-testid="rep-selector" className="space-y-2">
      {reps.map((rep) => (
        <button
          key={rep.id}
          data-testid={`rep-card-${rep.id}`}
          className="w-full rounded border border-gray-200 p-3 text-left hover:border-teal-400"
          onClick={() => onSelect(rep.id)}
        >
          <div className="flex items-baseline justify-between">
            <span className="font-medium">{rep.name}</span>
            <span className="text-xs text-gray-400">Verified {formatDate(rep.lastVerified)}</span>
          </div>
          <div className="mt-1 text-xs text-gray-600">
            {rep.title} · {rep.office}
            {rep.party && ` · ${rep.party}`}
            {rep.district && ` · District ${rep.district}`}
            {rep.state && ` · ${rep.state}`}
          </div>
          <div className="mt-1 flex gap-1">
            {channelBadges(rep).map((ch) => (
              <span
                key={ch}
                data-testid={`rep-channel-${ch}`}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
              >
                {ch}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
};
