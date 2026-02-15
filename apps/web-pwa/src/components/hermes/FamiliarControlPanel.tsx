import React, { useEffect, useMemo, useState } from 'react';
import type { DelegationTier } from '@vh/types';
import { useFamiliar } from '../../hooks/useFamiliar';
import { useXpLedger } from '../../store/xpLedger';

const TIER_OPTIONS: Array<{ value: DelegationTier; label: string }> = [
  { value: 'suggest', label: 'Suggest' },
  { value: 'act', label: 'Act' },
  { value: 'high-impact', label: 'High impact' }
];
const MINUTE_MS = 60_000;

interface PendingHighImpactRequest { familiarId: string; issuedAt: number; expiresAt: number; }

export interface FamiliarControlPanelProps { principalOverride?: string | null; now?: () => number; }

export function FamiliarControlPanel({ principalOverride, now }: FamiliarControlPanelProps): JSX.Element {
  const nowFn = now ?? Date.now;
  const {
    principalNullifier,
    familiars,
    grants,
    registerFamiliar,
    createTierGrant,
    revokeGrant,
    getGrantStatus
  } = useFamiliar(principalOverride);

  const activeNullifier = useXpLedger((state) => state.activeNullifier);
  const setActiveNullifier = useXpLedger((state) => state.setActiveNullifier);
  const canPerformAction = useXpLedger((state) => state.canPerformAction);
  const consumeAction = useXpLedger((state) => state.consumeAction);

  useEffect(() => {
    if (activeNullifier !== principalNullifier) {
      setActiveNullifier(principalNullifier);
    }
  }, [activeNullifier, principalNullifier, setActiveNullifier]);

  const [familiarLabel, setFamiliarLabel] = useState('');
  const [familiarTier, setFamiliarTier] = useState<DelegationTier>('suggest');
  const [selectedFamiliarId, setSelectedFamiliarId] = useState('');
  const [grantTier, setGrantTier] = useState<DelegationTier>('suggest');
  const [grantDurationMinutes, setGrantDurationMinutes] = useState('60');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingHighImpactRequest, setPendingHighImpactRequest] = useState<PendingHighImpactRequest | null>(null);

  const activeFamiliars = useMemo(() => familiars.filter((familiar) => familiar.revokedAt === undefined), [familiars]);
  const currentTime = nowFn();
  const activeGrants = grants.filter((grant) => getGrantStatus(grant.grantId, currentTime) === 'active');

  useEffect(() => {
    if (activeFamiliars.length === 0) {
      if (selectedFamiliarId !== '') {
        setSelectedFamiliarId('');
      }
      return;
    }
    const selectedStillActive = activeFamiliars.some((familiar) => familiar.id === selectedFamiliarId);
    if (!selectedStillActive) {
      setSelectedFamiliarId(activeFamiliars[0]!.id);
    }
  }, [activeFamiliars, selectedFamiliarId]);

  const clearMessages = () => {
    setError(null);
    setNotice(null);
  };

  const parseDurationMs = (): number | null => {
    const minutes = Number(grantDurationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError('Grant duration must be a positive number of minutes.');
      return null;
    }
    return Math.round(minutes * MINUTE_MS);
  };

  const issueGrantForTier = (tier: DelegationTier, request: PendingHighImpactRequest, shouldNotify = true) => {
    const grant = createTierGrant({
      familiarId: request.familiarId,
      tier,
      issuedAt: request.issuedAt,
      expiresAt: request.expiresAt
    });
    if (shouldNotify) {
      setNotice(`Grant ${grant.grantId} created (${tier}).`);
    }
    return grant;
  };

  const evaluateHighImpactBudgets = (): string | null => {
    const moderation = canPerformAction('moderation/day');
    if (!moderation.allowed) {
      return moderation.reason ?? 'moderation/day budget denied';
    }
    const civic = canPerformAction('civic_actions/day');
    if (!civic.allowed) {
      return civic.reason ?? 'civic_actions/day budget denied';
    }
    return null;
  };

  const handleRegisterFamiliar = () => {
    clearMessages();
    const trimmed = familiarLabel.trim();
    if (!trimmed) {
      setError('Familiar label is required.');
      return;
    }

    try {
      const familiar = registerFamiliar({ label: trimmed, capabilityPreset: familiarTier });
      setFamiliarLabel('');
      setSelectedFamiliarId(familiar.id);
      setNotice(`Familiar ${familiar.label} registered.`);
    } catch (registerError) {
      setError(String((registerError as Error).message));
    }
  };

  const handleCreateGrant = () => {
    clearMessages();
    if (!selectedFamiliarId) {
      setError('Select a familiar before creating a grant.');
      return;
    }
    const durationMs = parseDurationMs();
    if (durationMs === null) {
      return;
    }
    const issuedAt = nowFn();
    const request: PendingHighImpactRequest = {
      familiarId: selectedFamiliarId,
      issuedAt,
      expiresAt: issuedAt + durationMs
    };

    if (grantTier === 'high-impact') {
      const denialReason = evaluateHighImpactBudgets();
      if (denialReason) {
        setError(`High-impact grant denied: ${denialReason}`);
        return;
      }
      setPendingHighImpactRequest(request);
      return;
    }

    try {
      issueGrantForTier(grantTier, request);
    } catch (issueError) {
      setError(String((issueError as Error).message));
    }
  };

  const handleConfirmHighImpactGrant = () => {
    clearMessages();
    const denialReason = evaluateHighImpactBudgets();
    if (denialReason) {
      setError(`High-impact grant denied: ${denialReason}`);
      return;
    }
    try {
      const grant = issueGrantForTier('high-impact', pendingHighImpactRequest!, false);
      consumeAction('moderation/day');
      setNotice(`Grant ${grant.grantId} created (high-impact).`);
      setPendingHighImpactRequest(null);
    } catch (issueError) {
      const message = String((issueError as Error).message);
      setError(message.includes('moderation/day') ? `High-impact grant denied: ${message}` : message);
    }
  };

  const handleCancelHighImpactGrant = () => {
    setPendingHighImpactRequest(null);
    setNotice('High-impact grant request cancelled.');
  };

  const handleRevokeGrant = (grantId: string) => {
    clearMessages();
    try {
      revokeGrant(grantId, nowFn());
      setNotice(`Grant ${grantId} revoked.`);
    } catch (revokeError) {
      setError(String((revokeError as Error).message));
    }
  };

  return (
    <section
      aria-label="Familiar control panel"
      className="space-y-4 rounded-xl border border-slate-700 p-4"
      data-testid="familiar-control-panel"
    >
      <header>
        <h2 className="text-base font-semibold">Familiar Control Panel</h2>
        <p className="text-xs text-slate-400" data-testid="principal-nullifier">Principal: {principalNullifier ?? 'none'}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-sm" data-testid="familiar-control-error">
          {error}
        </p>
      )}

      {notice && (
        <p className="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm" data-testid="familiar-control-notice">
          {notice}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Register familiar</h3>
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
          <input
            value={familiarLabel}
            onChange={(event) => setFamiliarLabel(event.target.value)}
            placeholder="Familiar label"
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            data-testid="familiar-label-input"
          />
          <select
            value={familiarTier}
            onChange={(event) => setFamiliarTier(event.target.value as DelegationTier)}
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            data-testid="familiar-tier-select"
          >
            {TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            type="button"
            onClick={handleRegisterFamiliar}
            className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900"
            data-testid="register-familiar-button"
          >
            Add
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Create grant</h3>
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <select
            value={selectedFamiliarId}
            onChange={(event) => setSelectedFamiliarId(event.target.value)}
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            data-testid="grant-familiar-select"
          >
            <option value="">Select familiar</option>
            {activeFamiliars.map((familiar) => <option key={familiar.id} value={familiar.id}>{familiar.label}</option>)}
          </select>
          <select
            value={grantTier}
            onChange={(event) => setGrantTier(event.target.value as DelegationTier)}
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            data-testid="grant-tier-select"
          >
            {TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input
            value={grantDurationMinutes}
            onChange={(event) => setGrantDurationMinutes(event.target.value)}
            inputMode="numeric"
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            data-testid="grant-duration-input"
            aria-label="Grant duration in minutes"
          />
          <button
            type="button"
            onClick={handleCreateGrant}
            className="rounded-md bg-cyan-300 px-3 py-2 text-sm font-medium text-slate-900"
            data-testid="create-grant-button"
          >
            Create
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Active grants</h3>
        {activeGrants.length === 0 ? (
          <p className="text-sm text-slate-400" data-testid="empty-active-grants">No active grants.</p>
        ) : (
          <ul className="space-y-2" data-testid="active-grants-list">
            {activeGrants.map((grant) => (
              <li
                key={grant.grantId}
                className="flex items-center justify-between rounded-md border border-slate-700 px-3 py-2"
                data-testid={`grant-row-${grant.grantId}`}
              >
                <span className="text-sm"><strong>{grant.grantId}</strong> · familiar {grant.familiarId} · scopes {grant.scopes.join(', ')}</span>
                <button
                  type="button"
                  onClick={() => handleRevokeGrant(grant.grantId)}
                  className="rounded-md border border-rose-400 px-2 py-1 text-xs"
                  data-testid={`revoke-grant-${grant.grantId}`}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingHighImpactRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="high-impact-modal-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="high-impact-title"
            aria-describedby="high-impact-description"
            className="w-full max-w-md rounded-xl bg-slate-900 p-4 shadow-xl"
          >
            <h4 id="high-impact-title" className="text-base font-semibold">Approve high-impact grant</h4>
            <p id="high-impact-description" className="mt-2 text-sm text-slate-300">
              This grant enables high-impact scopes (moderate, vote, fund, civic action). Confirm human approval to continue.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelHighImpactGrant}
                className="rounded-md border border-slate-500 px-3 py-2 text-sm"
                data-testid="cancel-high-impact-button"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmHighImpactGrant}
                className="rounded-md bg-amber-300 px-3 py-2 text-sm font-medium text-slate-900"
                data-testid="confirm-high-impact-button"
              >
                Approve grant
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default FamiliarControlPanel;
