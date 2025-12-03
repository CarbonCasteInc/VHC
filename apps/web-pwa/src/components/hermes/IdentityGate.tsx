import React from 'react';
import { Button } from '@vh/ui';
import { useIdentity } from '../../hooks/useIdentity';

export const IdentityGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { identity, status, createIdentity } = useIdentity();
  const loading = status === 'creating';

  if (identity?.session?.nullifier) {
    return <>{children}</>;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-card p-4 text-slate-800 shadow-sm dark:border-slate-700">
      <p className="font-semibold text-slate-900">Create identity to start messaging</p>
      <p className="text-sm text-slate-600">HERMES Messaging requires an active session.</p>
      <Button className="mt-3" disabled={loading} onClick={() => createIdentity()}>
        {loading ? 'Creating…' : 'Create identity'}
      </Button>
    </div>
  );
};
