/**
 * InviteGate — Route-level invite-only gating for closed beta.
 *
 * When VITE_INVITE_ONLY_ENABLED is active and user has no stored
 * access, shows a token redemption form. On valid token, persists
 * access via grantInviteAccess() and renders children.
 */
import React, { useCallback, useState } from 'react';
import {
  isInviteOnlyEnabled,
  hasInviteAccess,
  grantInviteAccess,
  validateInviteToken,
  redeemInviteToken,
  checkRateLimit,
  recordAttempt,
  appendAuditEntry,
} from '../store/invite';

export interface InviteGateProps {
  children: React.ReactNode;
  /** @internal test override: force gate enabled regardless of env */
  _forceEnabled?: boolean;
  /** @internal test override: force access granted */
  _forceAccess?: boolean;
}

export const InviteGate: React.FC<InviteGateProps> = ({
  children,
  _forceEnabled,
  _forceAccess,
}) => {
  const enabled = _forceEnabled ?? isInviteOnlyEnabled();
  const preGranted = _forceAccess ?? hasInviteAccess();

  if (!enabled || preGranted) {
    return <>{children}</>;
  }

  return <InviteForm onGranted={() => {}}>{children}</InviteForm>;
};

interface InviteFormProps {
  children: React.ReactNode;
  onGranted: () => void;
}

const InviteForm: React.FC<InviteFormProps> = ({ children }) => {
  const [granted, setGranted] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmed = code.trim();
      if (!trimmed) return;

      const rateCheck = checkRateLimit('redeem');
      if (!rateCheck.allowed) {
        const secs = Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000);
        setError(`Too many attempts. Try again in ${secs}s.`);
        appendAuditEntry('invite_validation_failed', { token: trimmed, reason: 'rate_limited' });
        return;
      }

      recordAttempt('redeem');
      const result = redeemInviteToken(trimmed, 'web-user');

      if (result.valid) {
        grantInviteAccess();
        appendAuditEntry('invite_redeemed', { token: trimmed });
        setGranted(true);
      } else {
        setError(result.reason ?? 'Invalid invite code.');
        appendAuditEntry('invite_validation_failed', { token: trimmed, reason: result.reason });
      }
    },
    [code],
  );

  if (granted) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900" data-testid="invite-gate">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-700 dark:bg-slate-800">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">Invite Only</h1>
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">Enter your invite code to access the beta.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Invite code"
            autoFocus
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-50"
            data-testid="invite-code-input"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400" data-testid="invite-error">{error}</p>}
          <button
            type="submit"
            disabled={!code.trim()}
            className="w-full rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            data-testid="invite-submit"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
};

export default InviteGate;
