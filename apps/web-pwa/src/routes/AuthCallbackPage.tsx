import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Button } from '@vh/ui';
import { useIdentity } from '../hooks/useIdentity';
import { useSignIn } from '../hooks/useSignIn';

type CallbackStatus = 'working' | 'done' | 'error';

interface CallbackSearch {
  code?: string;
  state?: string;
  returnTopicId?: string;
  returnPointId?: string;
}

/**
 * OAuth redirect landing route (Slice C0/C2/C3). The provider (or the
 * e2e mock authorize URL) redirects here with `code` + `state`. We
 * complete the PKCE exchange against the boundary, hydrate-or-create the
 * device-bound LUMA identity, bind the account, and route the user back
 * to where they started (a story/point, if carried) or the account page.
 *
 * A sign-in failure never strands a partial vote: we route back to the
 * return target regardless, and the vote is only ever admitted after a
 * fully successful sign-in + binding (retry-only-after-full-success).
 */
export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const { location } = useRouterState();
  const identity = useIdentity();
  const identityBridge = useMemo(
    () => ({
      status: identity.status,
      activeNullifier: identity.identity?.session?.nullifier ?? null,
      ensureIdentity: identity.ensureIdentity,
    }),
    [identity.status, identity.identity?.session?.nullifier, identity.ensureIdentity],
  );
  const { completeFromCallback, error } = useSignIn(identityBridge);

  const [status, setStatus] = useState<CallbackStatus>('working');
  const startedRef = useRef(false);

  const search = location.search as CallbackSearch;
  const code = typeof search.code === 'string' ? search.code : '';
  const state = typeof search.state === 'string' ? search.state : '';
  const returnTopicId = typeof search.returnTopicId === 'string' ? search.returnTopicId : undefined;
  const returnPointId = typeof search.returnPointId === 'string' ? search.returnPointId : undefined;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const ok = await completeFromCallback({ code, state });
      setStatus(ok ? 'done' : 'error');
      if (ok) {
        if (returnTopicId) {
          void navigate({
            to: '/',
            search: { topicId: returnTopicId, ...(returnPointId ? { pointId: returnPointId } : {}) },
          });
        } else {
          void navigate({ to: '/account/identity' });
        }
      }
    })();
  }, [code, state, returnTopicId, returnPointId, completeFromCallback, navigate]);

  return (
    <section className="rounded-lg border border-slate-200 bg-card p-5 shadow-sm dark:border-slate-700" data-testid="auth-callback-panel">
      {status === 'working' && (
        <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="auth-callback-working">
          Completing sign-in...
        </p>
      )}
      {status === 'done' && (
        <p className="text-sm text-emerald-800" data-testid="auth-callback-done">
          Signed in. Returning you to where you left off.
        </p>
      )}
      {status === 'error' && (
        <div className="space-y-3" data-testid="auth-callback-error">
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            Sign-in did not complete{error ? ` (${error})` : ''}. No vote was saved. You can try again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/account/identity">
              <Button type="button" variant="secondary">Back to account</Button>
            </Link>
          </div>
        </div>
      )}
    </section>
  );
};

export default AuthCallbackPage;
