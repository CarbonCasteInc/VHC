import React from 'react';
import { Button } from '@vh/ui';
import QRCode from 'react-qr-code';
import { useIdentity } from '../../hooks/useIdentity';

export const ContactQR: React.FC = () => {
  const { identity } = useIdentity();
  const key = identity?.session?.nullifier ?? 'no-identity';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(key);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Share your identity key</p>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-36 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700">
          <QRCode value={key} size={128} />
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-xs text-slate-600 break-all">{key}</p>
          <Button size="sm" onClick={() => void handleCopy()}>
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
};
