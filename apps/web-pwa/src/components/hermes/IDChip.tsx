import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@vh/ui';
import QRCode from 'react-qr-code';
import { deriveIdentityDirectoryKey } from '@vh/types';
import { useIdentity } from '../../hooks/useIdentity';
import { getHandleError } from '../../utils/handle';

export const IDChip: React.FC = () => {
  const { identity } = useIdentity();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [identityDirectoryKey, setIdentityDirectoryKey] = useState<string | null>(null);

  useEffect(() => {
    const principalNullifier = identity?.session?.nullifier;
    if (!principalNullifier) {
      setIdentityDirectoryKey(null);
      return;
    }

    let cancelled = false;
    deriveIdentityDirectoryKey(principalNullifier)
      .then((derived) => {
        if (!cancelled) setIdentityDirectoryKey(derived);
      })
      .catch(() => {
        if (!cancelled) setIdentityDirectoryKey(null);
      });

    return () => {
      cancelled = true;
    };
  }, [identity?.session?.nullifier]);

  const payload = useMemo(() => {
    if (!identityDirectoryKey || !identity?.devicePair?.epub) return null;
    const handleError = identity.handle ? getHandleError(identity.handle) : null;
    const safeHandle = handleError ? undefined : identity.handle;
    return {
      identityDirectoryKey,
      epub: identity.devicePair.epub,
      handle: safeHandle
    };
  }, [identity, identityDirectoryKey]);

  const encoded = payload ? JSON.stringify(payload) : 'no-identity';
  const displayLabel =
    payload && payload.identityDirectoryKey
      ? `@${payload.handle ?? 'anonymous'} • ${payload.identityDirectoryKey.slice(0, 10)}…`
      : 'no-identity';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(encoded);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="sticky top-0 z-10 rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Your ID</p>
          <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="idchip-label">
            {displayLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowQR((prev) => !prev)} aria-expanded={showQR}>
            Show QR
          </Button>
          <Button size="sm" onClick={() => void handleCopy()} aria-live="polite">
            {copied ? 'Copied!' : 'Copy ID'}
          </Button>
        </div>
      </div>
      {showQR && (
        <div className="mt-3 flex items-center gap-3">
          <div
            className="h-36 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700"
            data-testid="idchip-qr"
          >
            <QRCode value={encoded} size={128} />
          </div>
          <p className="text-[11px] text-slate-600 break-all" data-testid="idchip-data">
            {encoded}
          </p>
        </div>
      )}
    </div>
  );
};

// Temporary backwards-compatible export until callers are updated.
export const ContactQR = IDChip;
