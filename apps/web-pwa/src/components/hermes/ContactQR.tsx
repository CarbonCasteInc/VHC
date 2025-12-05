import React from 'react';
import { Button } from '@vh/ui';
import QRCode from 'react-qr-code';
import { useIdentity } from '../../hooks/useIdentity';

export const ContactQR: React.FC = () => {
  const { identity } = useIdentity();
  const contactData =
    identity?.session?.nullifier && identity?.devicePair?.epub
      ? JSON.stringify({
          nullifier: identity.session.nullifier,
          epub: identity.devicePair.epub
        })
      : 'no-identity';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(contactData);
  };

  const displayLabel =
    contactData === 'no-identity'
      ? contactData
      : (() => {
          try {
            const parsed = JSON.parse(contactData) as { nullifier?: string; epub?: string };
            if (parsed.nullifier && parsed.epub) {
              return `${parsed.nullifier.slice(0, 10)}… | epub:${parsed.epub.slice(0, 8)}…`;
            }
            return contactData;
          } catch {
            return contactData;
          }
        })();

  return (
    <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Share your identity key</p>
      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-36 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700"
          data-testid="contact-qr"
        >
          <QRCode value={contactData} size={128} />
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-xs text-slate-600 break-all" data-testid="identity-key">
            {displayLabel}
          </p>
          {/* Hidden element with full contact JSON for E2E tests */}
          <span data-testid="contact-data" className="hidden">{contactData}</span>
          <Button size="sm" onClick={() => void handleCopy()}>
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
};
