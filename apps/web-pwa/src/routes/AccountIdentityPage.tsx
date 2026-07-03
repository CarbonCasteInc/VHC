import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@vh/ui';
import { useIdentity } from '../hooks/useIdentity';
import { useTelemetry } from '../hooks/useTelemetry';
import { useWallet } from '../hooks/useWallet';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type DialogMode = 'sign-out' | 'reset';

function formatUtcTimestamp(value?: number): string {
  if (!value) return 'Not scheduled';
  return `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('aria-hidden'));
}

interface ConfirmationDialogProps {
  readonly mode: DialogMode;
  readonly busy: boolean;
  readonly error?: string;
  readonly resetInput: string;
  readonly onResetInput: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  mode,
  busy,
  error,
  resetInput,
  onResetInput,
  onCancel,
  onConfirm
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = mode === 'sign-out' ? 'identity-sign-out-title' : 'identity-reset-title';
  const bodyId = mode === 'sign-out' ? 'identity-sign-out-body' : 'identity-reset-body';
  const resetConfirmed = resetInput.trim().toLowerCase() === 'reset';

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusableElements(dialogRef.current)[0] ?? dialogRef.current;
    first?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = focusableElements(dialogRef.current);
    if (!focusables.length) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-950"
      >
        {mode === 'sign-out' ? (
          <>
            <h2 id={titleId} className="text-lg font-semibold text-slate-950 dark:text-slate-50">
              Sign out of this device?
            </h2>
            <p id={bodyId} className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
              Signing out ends your current session. Your identity stays on this device: signing back in restores the same
              pseudonym, wallet binding, and reputation. Your published posts and votes are unaffected.
            </p>
          </>
        ) : (
          <>
            <h2 id={titleId} className="text-lg font-semibold text-slate-950 dark:text-slate-50">
              Reset your identity on this device?
            </h2>
            <p id={bodyId} className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
              Resetting stops using the current pseudonym and rotates the identity material on this device. The next
              identity you create on this device uses a new pseudonym. Your previous posts, comments, and votes remain
              public under your old pseudonym. Resetting does not remove them and cannot make them yours again. Your
              wallet must be re-bound, and any operator authorization or delegations are cleared.
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-800 dark:text-slate-100" htmlFor="identity-reset-input">
              Type reset to confirm
            </label>
            <input
              id="identity-reset-input"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              value={resetInput}
              onChange={(event) => onResetInput(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid={mode === 'sign-out' ? 'identity-sign-out-confirm' : 'identity-reset-confirm'}
            onClick={onConfirm}
            disabled={busy || (mode === 'reset' && !resetConfirmed)}
            aria-disabled={busy || (mode === 'reset' && !resetConfirmed)}
            className={mode === 'reset' ? 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500' : undefined}
          >
            {busy ? (mode === 'sign-out' ? 'Signing out...' : 'Resetting...') : mode === 'sign-out' ? 'Sign out' : 'Reset identity'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const AccountIdentityPage: React.FC = () => {
  const { identity, status, error, createIdentity, signOut, resetIdentity } = useIdentity();
  const { events } = useTelemetry();
  const { account, walletBinding, connect: connectWallet, loading: walletLoading } = useWallet();
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [resetInput, setResetInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [toast, setToast] = useState<string | undefined>();

  const createdAt = identity?.session?.createdAt ?? identity?.createdAt;
  const expiresAt = identity?.session?.expiresAt;
  const now = Date.now();
  const expiresSoon = Boolean(expiresAt && expiresAt > now && expiresAt - now <= ONE_DAY_MS);
  const activePrincipal = identity?.session?.nullifier ?? null;
  const walletNeedsRebind = Boolean(
    activePrincipal
    && account
    && (!walletBinding?.boundPrincipalNullifier || walletBinding.boundPrincipalNullifier !== activePrincipal)
  );

  const recentEvents = useMemo(() => events.slice(-5).reverse(), [events]);

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setResetInput('');
    setActionError(undefined);
  };

  const runAction = async (mode: DialogMode) => {
    setBusy(true);
    setActionError(undefined);
    try {
      if (mode === 'sign-out') {
        await signOut();
        setToast('Signed out. Your device identity remains available for re-attestation.');
      } else {
        await resetIdentity();
        setToast("Identity reset. Your previous pseudonym's public history remains on the network.");
      }
      setDialog(null);
      setResetInput('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (status === 'hydrating') {
    return (
      <section className="rounded-lg border border-slate-200 bg-card p-5 shadow-sm dark:border-slate-700" data-testid="identity-panel">
        <p className="text-sm text-slate-700 dark:text-slate-200">Loading identity...</p>
      </section>
    );
  }

  if (!identity || status === 'anonymous' || status === 'creating' || status === 'error') {
    return (
      <section className="space-y-4 rounded-lg border border-slate-200 bg-card p-5 shadow-sm dark:border-slate-700" data-testid="identity-panel">
        <div>
          <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Identity</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">No active session on this device.</p>
        </div>
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <Button type="button" onClick={() => void createIdentity()} disabled={status === 'creating'} data-testid="identity-create">
          {status === 'creating' ? 'Creating...' : 'Create identity'}
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-5" data-testid="identity-panel">
      <div className="rounded-lg border border-slate-200 bg-card p-5 shadow-sm dark:border-slate-700">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Identity</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Beta-local identity on this device</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" data-testid="identity-sign-out" onClick={() => setDialog('sign-out')} disabled={busy}>
              Sign out
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="identity-reset"
              onClick={() => setDialog('reset')}
              disabled={busy}
              className="border border-red-200 text-red-700 hover:bg-red-50 focus-visible:ring-red-500"
            >
              Reset identity
            </Button>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-100 bg-card-muted px-3 py-2 dark:border-slate-700/70">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Created</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{formatUtcTimestamp(createdAt)}</dd>
          </div>
          <div className="rounded-md border border-slate-100 bg-card-muted px-3 py-2 dark:border-slate-700/70" data-testid="identity-session-expiry">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Expires</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{formatUtcTimestamp(expiresAt)}</dd>
          </div>
          <div className="rounded-md border border-slate-100 bg-card-muted px-3 py-2 dark:border-slate-700/70">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Verifier</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">beta-local</dd>
          </div>
        </dl>

        {(expiresSoon || status === 'expired') && (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Your session expires soon. Re-attest to continue posting and voting. Browsing is unaffected.
          </p>
        )}
      </div>

      {walletNeedsRebind && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm"
          data-testid="identity-wallet-rebind"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              This wallet is not bound to your current identity. Re-bind it to continue.
            </p>
            <Button type="button" variant="secondary" onClick={() => void connectWallet()} disabled={walletLoading}>
              Re-bind wallet
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-card p-5 shadow-sm dark:border-slate-700">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">Local telemetry</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Recent local LUMA events are shown without tokens, keys, proof material, or mesh paths.
            </p>
          </div>
          <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {events.length} events
          </span>
        </div>
        <ul className="mt-4 space-y-2" data-testid="identity-telemetry-debug">
          {recentEvents.length ? (
            recentEvents.map((event, index) => (
              <li key={`${event.type}-${index}`} className="rounded-md border border-slate-100 bg-card-muted px-3 py-2 text-sm dark:border-slate-700/70">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{event.type}</span>
                <span className="ml-2 text-xs text-slate-500">{event.level}</span>
              </li>
            ))
          ) : (
            <li className="text-sm text-slate-600 dark:text-slate-300">No local LUMA events recorded.</li>
          )}
        </ul>
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-slate-600 dark:text-slate-300">
        <Link to="/support" className="underline underline-offset-4">Support</Link>
        <Link to="/data-deletion" className="underline underline-offset-4">Data controls</Link>
      </div>

      <div aria-live="polite" className="sr-only">
        {toast}
      </div>
      {toast && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {toast}
        </p>
      )}

      {dialog && (
        <ConfirmationDialog
          mode={dialog}
          busy={busy}
          error={actionError}
          resetInput={resetInput}
          onResetInput={setResetInput}
          onCancel={closeDialog}
          onConfirm={() => void runAction(dialog)}
        />
      )}
    </section>
  );
};
