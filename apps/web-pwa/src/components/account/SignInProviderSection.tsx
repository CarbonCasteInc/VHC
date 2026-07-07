import React, { useMemo } from 'react';
import { Button } from '@vh/ui';
import { useSignIn, type SignInIdentityBridge } from '../../hooks/useSignIn';
import type { SignInFlowProvider } from '../../auth/signInFlow';
import type { SignInAccountRecord } from '@vh/data-model';

const PROVIDER_LABELS: Record<SignInFlowProvider, string> = {
  apple: 'Apple',
  google: 'Google',
  x: 'X',
  mock: 'Mock (test)',
};

function statusLabel(record: SignInAccountRecord | undefined): string {
  if (!record) return 'Not connected';
  if (record.status === 'signed-in') return 'Connected';
  if (record.status === 'expired') return 'Session expired — reconnect';
  return 'Signed out';
}

export interface SignInProviderSectionProps {
  readonly identity: SignInIdentityBridge;
}

/**
 * Account sign-in provider management (Slice C3). Distinct from the
 * flag-gated linked-social notification-account feature: this drives
 * account continuity/recovery only, never human-uniqueness. Copy stays
 * inside the claim boundary — no verified-human / one-human-one-vote /
 * anonymity language.
 */
export const SignInProviderSection: React.FC<SignInProviderSectionProps> = ({ identity }) => {
  const { providers, accounts, phase, error, beginSignIn, signOutProvider } = useSignIn(identity);

  const accountByProvider = useMemo(() => {
    const map = new Map<string, SignInAccountRecord>();
    for (const account of accounts) {
      map.set(account.providerId, account);
    }
    return map;
  }, [accounts]);

  const connect = async (provider: SignInFlowProvider) => {
    const authorizeUrl = await beginSignIn(provider);
    if (!authorizeUrl) return;
    // Same-origin mock authorize URLs and cross-origin provider authorize
    // URLs are both handled by a full navigation: the app-side callback
    // route completes the round-trip. No PKCE material rides the URL.
    window.location.assign(authorizeUrl);
  };

  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-card p-5 shadow-sm dark:border-slate-700" data-testid="signin-providers">
        <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">Sign-in accounts</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Account sign-in is not configured in this build. You can still create a beta-local identity above.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-card p-5 shadow-sm dark:border-slate-700" data-testid="signin-providers">
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">Sign-in accounts</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Connect Apple, Google, or X for account continuity and profile recovery. This is not a proof of a unique person,
          and your votes always stay under your beta-local identity on this device.
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert" data-testid="signin-error">
          Sign-in could not start ({error}).
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {providers.map((provider) => {
          const record = accountByProvider.get(provider);
          const connected = record?.status === 'signed-in';
          return (
            <li
              key={provider}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-100 bg-card-muted px-3 py-2 dark:border-slate-700/70"
              data-testid={`signin-provider-${provider}`}
            >
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{PROVIDER_LABELS[provider]}</p>
                <p className="text-xs text-slate-500" data-testid={`signin-status-${provider}`}>
                  {statusLabel(record)}
                  {record?.displayLabel ? ` · ${record.displayLabel}` : ''}
                </p>
              </div>
              {connected && record ? (
                <Button
                  type="button"
                  variant="ghost"
                  data-testid={`signin-disconnect-${provider}`}
                  onClick={() => signOutProvider(record)}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  data-testid={`signin-connect-${provider}`}
                  disabled={phase === 'starting'}
                  onClick={() => void connect(provider)}
                >
                  {phase === 'starting' ? 'Starting...' : 'Connect'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-slate-500">
        Disconnecting removes the account link on this device. It does not delete anything from the provider or the
        network, and your beta-local identity and its history are unaffected.
      </p>
    </div>
  );
};

export default SignInProviderSection;
