/**
 * Delivery intent adapters — user-initiated civic action delivery channels.
 *
 * Each adapter opens the appropriate native interface.
 * All no-op in E2E mode (VITE_E2E_MODE=true).
 *
 * Spec: spec-civic-action-kit-v0.md §4.3
 */

import type { CivicAction, Representative, DeliveryIntent } from '@vh/data-model';

/* ── E2E guard ──────────────────────────────────────────────── */

function isE2E(): boolean {
  /* v8 ignore next 2 -- browser env */
  const v = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_E2E_MODE;
  /* v8 ignore next 2 -- node fallback */
  const n = typeof process !== 'undefined' ? process.env?.VITE_E2E_MODE : undefined;
  return (n ?? v) === 'true';
}

/* ── Intent handlers ────────────────────────────────────────── */

export function openMailto(email: string | undefined, subject: string, body: string): void {
  if (!email) return;
  const params = new URLSearchParams({ subject, body });
  window.open(`mailto:${email}?${params.toString()}`, '_self');
}

export function openTel(phone: string | undefined): void {
  if (!phone) return;
  window.open(`tel:${phone}`, '_self');
}

export async function openShareSheet(title: string, text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    /* v8 ignore next 3 -- user cancel / unsupported */
    } catch {
      // Fall through to clipboard
    }
  }
  /* v8 ignore next 3 -- clipboard fallback */
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

export function exportReportFile(blobUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
}

export function openContactPage(contactUrl: string | undefined): void {
  if (!contactUrl) return;
  window.open(contactUrl, '_blank', 'noopener,noreferrer');
}

/* ── Dispatcher ─────────────────────────────────────────────── */

export interface DeliveryChannelResult {
  dispatched: boolean;
  intent: DeliveryIntent;
  reason?: string;
}

/**
 * Open the delivery channel matching the action's intent.
 * No-op in E2E mode.
 * Spec: spec-civic-action-kit-v0.md §4.3
 */
export async function openDeliveryChannel(
  action: CivicAction,
  rep: Representative,
  intent: DeliveryIntent,
  reportBlobUrl?: string,
): Promise<DeliveryChannelResult> {
  if (isE2E()) {
    return { dispatched: false, intent, reason: 'e2e-mode' };
  }

  switch (intent) {
    case 'email':
      openMailto(rep.email, action.subject, action.body);
      return { dispatched: !!rep.email, intent, reason: rep.email ? undefined : 'no-email' };

    case 'phone':
      openTel(rep.phone);
      return { dispatched: !!rep.phone, intent, reason: rep.phone ? undefined : 'no-phone' };

    case 'share':
      await openShareSheet(action.topic, action.body);
      return { dispatched: true, intent };

    case 'export':
      if (reportBlobUrl) {
        exportReportFile(reportBlobUrl, `civic-action-${action.id}.html`);
        return { dispatched: true, intent };
      }
      return { dispatched: false, intent, reason: 'no-report' };

    case 'manual':
      openContactPage(rep.contactUrl);
      return { dispatched: !!rep.contactUrl, intent, reason: rep.contactUrl ? undefined : 'no-contact-url' };
  }
}
