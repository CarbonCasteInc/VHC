/**
 * BridgeLayout — Container/routing for the civic action center.
 *
 * Gates entire component behind VITE_ELEVATION_ENABLED.
 * Shows trust gating reason if below threshold.
 *
 * Spec: spec-civic-action-kit-v0.md §8
 */

import React, { useState } from 'react';
import { TRUST_MINIMUM } from '@vh/data-model';
import { scoreFromEnvelope } from '@vh/luma-sdk';
import { useIdentity } from '../../hooks/useIdentity';
import { RepresentativeSelector } from './RepresentativeSelector';
import { ActionComposer } from './ActionComposer';
import { ActionHistory } from './ActionHistory';
import { DistrictOfficeSentiment } from './DistrictOfficeSentiment';
import { useRepresentativeDirectorySync } from '../../store/bridge/representativeDirectorySync';

/* ── Feature flag ────────────────────────────────────────────── */

function isEnabled(): boolean {
  /* v8 ignore next 2 -- browser env resolves import.meta differently */
  const viteValue = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_ELEVATION_ENABLED;
  /* v8 ignore next 3 -- browser runtime may not expose process */
  const nodeValue =
    typeof process !== 'undefined' ? process.env?.VITE_ELEVATION_ENABLED : undefined;
  /* v8 ignore next 1 -- ?? fallback only reachable in-browser */
  return (nodeValue ?? viteValue) === 'true';
}

export type BridgeSection = 'representatives' | 'compose' | 'history' | 'sentiment';

const SECTION_LABELS: Record<BridgeSection, string> = {
  representatives: 'Representatives',
  compose: 'Compose Action',
  history: 'History',
  sentiment: 'Local Sentiment',
};

export interface BridgeLayoutProps {
  readonly initialSection?: BridgeSection;
}

export const BridgeLayout: React.FC<BridgeLayoutProps> = ({ initialSection = 'representatives' }) => {
  const { identity } = useIdentity();
  // Read-surface entry gate: reconciled with Slice D1's no-direct-comparison
  // rule by routing the §2 threshold through scoreFromEnvelope (§4) rather than
  // comparing a raw session trustScore. Bridge entry is a read surface, so it is
  // not canPerform-gated (spec-luma-service-v0 §5); write actions inside the
  // Compose flow still carry their own LUMA envelopes.
  const entryScore = scoreFromEnvelope(identity?.assuranceEnvelope);
  const [section, setSection] = useState<BridgeSection>(initialSection);
  const [selectedRepId, setSelectedRepId] = useState<string | undefined>();

  // Pull the system-writer-validated representative directory into the local
  // store when the bridge surface mounts. A validation failure leaves the
  // existing local directory unchanged (fail-closed).
  useRepresentativeDirectorySync();

  if (!isEnabled()) {
    return (
      <div data-testid="bridge-disabled" className="p-4 text-sm text-gray-500">
        Civic Action Center is not enabled.
      </div>
    );
  }

  if (entryScore < TRUST_MINIMUM) {
    return (
      <div data-testid="bridge-trust-gate" className="p-4">
        <p className="text-sm text-amber-600">
          Your trust score ({entryScore.toFixed(2)}) is below the 0.50 threshold required
          to access the Civic Action Center. Complete identity verification to increase your score.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="bridge-layout" className="space-y-4 p-4">
      <nav className="flex gap-2" data-testid="bridge-nav">
        {(['representatives', 'compose', 'history', 'sentiment'] as const).map((s) => (
          <button
            key={s}
            data-testid={`bridge-nav-${s}`}
            className={`rounded px-3 py-1 text-sm ${section === s ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700'}`}
            onClick={() => setSection(s)}
          >
            {SECTION_LABELS[s]}
          </button>
        ))}
      </nav>

      {section === 'representatives' && (
        <RepresentativeSelector
          onSelect={(repId) => {
            setSelectedRepId(repId);
            setSection('compose');
          }}
        />
      )}

      {section === 'compose' && (
        <ActionComposer selectedRepId={selectedRepId} />
      )}

      {section === 'history' && <ActionHistory />}

      {section === 'sentiment' && <DistrictOfficeSentiment />}
    </div>
  );
};
