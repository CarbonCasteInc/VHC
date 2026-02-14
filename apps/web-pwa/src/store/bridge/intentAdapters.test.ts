import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CivicAction, Representative } from '@vh/data-model';
import {
  openMailto,
  openTel,
  openShareSheet,
  exportReportFile,
  openContactPage,
  openDeliveryChannel,
} from './intentAdapters';

/* ── Test data ───────────────────────────────────────────────── */

const validProof = { district_hash: 'h', nullifier: 'n', merkle_root: 'r' };

const action: CivicAction = {
  id: 'action-1',
  schemaVersion: 'hermes-action-v1',
  author: 'null-1',
  sourceTopicId: 'topic-1',
  sourceSynthesisId: 'synth-1',
  sourceEpoch: 1,
  sourceArtifactId: 'brief-1',
  representativeId: 'rep-1',
  topic: 'Infrastructure',
  stance: 'support',
  subject: 'Support bill',
  body: 'I am writing to express my support for the proposed infrastructure bill. This initiative is critical.',
  intent: 'email',
  constituencyProof: validProof,
  status: 'ready',
  createdAt: Date.now(),
  attempts: 0,
};

const rep: Representative = {
  id: 'rep-1',
  name: 'Jane Doe',
  title: 'Representative',
  office: 'house',
  country: 'US',
  districtHash: 'h',
  contactMethod: 'both',
  email: 'jane@house.gov',
  phone: '+12025551234',
  contactUrl: 'https://house.gov/contact',
  lastVerified: Date.now(),
};

beforeEach(() => {
  vi.stubEnv('VITE_E2E_MODE', 'false');
  vi.stubGlobal('window', { open: vi.fn() });
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ click: vi.fn() })) });
  vi.stubGlobal('navigator', {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ── Individual handlers ─────────────────────────────────────── */

describe('openMailto', () => {
  it('opens mailto with subject and body', () => {
    openMailto('jane@gov', 'Subject', 'Body text');
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('mailto:jane@gov'),
      '_self',
    );
  });

  it('no-ops when email is undefined', () => {
    openMailto(undefined, 'Subject', 'Body');
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('openTel', () => {
  it('opens tel URI', () => {
    openTel('+12025551234');
    expect(window.open).toHaveBeenCalledWith('tel:+12025551234', '_self');
  });

  it('no-ops when phone is undefined', () => {
    openTel(undefined);
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('openShareSheet', () => {
  it('calls navigator.share when available', async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: shareFn });
    await openShareSheet('Title', 'Text');
    expect(shareFn).toHaveBeenCalledWith({ title: 'Title', text: 'Text' });
  });
});

describe('exportReportFile', () => {
  it('creates anchor and triggers download', () => {
    const clickFn = vi.fn();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ click: clickFn, href: '', download: '' })),
    });
    exportReportFile('blob:http://localhost/abc', 'report.html');
    expect(clickFn).toHaveBeenCalled();
  });
});

describe('openContactPage', () => {
  it('opens contact URL in new tab', () => {
    openContactPage('https://house.gov/contact');
    expect(window.open).toHaveBeenCalledWith(
      'https://house.gov/contact',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('no-ops when contactUrl is undefined', () => {
    openContactPage(undefined);
    expect(window.open).not.toHaveBeenCalled();
  });
});

/* ── Dispatcher ──────────────────────────────────────────────── */

describe('openDeliveryChannel', () => {
  it('returns e2e-mode result in E2E', async () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    const result = await openDeliveryChannel(action, rep, 'email');
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('e2e-mode');
  });

  it('dispatches email intent', async () => {
    const result = await openDeliveryChannel(action, rep, 'email');
    expect(result.dispatched).toBe(true);
    expect(result.intent).toBe('email');
  });

  it('reports no-email when rep lacks email', async () => {
    const noEmail = { ...rep, email: undefined };
    const result = await openDeliveryChannel(action, noEmail, 'email');
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no-email');
  });

  it('dispatches phone intent', async () => {
    const result = await openDeliveryChannel(action, rep, 'phone');
    expect(result.dispatched).toBe(true);
  });

  it('reports no-phone when rep lacks phone', async () => {
    const noPhone = { ...rep, phone: undefined };
    const result = await openDeliveryChannel(action, noPhone, 'phone');
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no-phone');
  });

  it('dispatches share intent', async () => {
    const result = await openDeliveryChannel(action, rep, 'share');
    expect(result.dispatched).toBe(true);
  });

  it('dispatches export intent with blob URL', async () => {
    const result = await openDeliveryChannel(action, rep, 'export', 'blob:http://x/y');
    expect(result.dispatched).toBe(true);
  });

  it('reports no-report when export lacks blob URL', async () => {
    const result = await openDeliveryChannel(action, rep, 'export');
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no-report');
  });

  it('dispatches manual intent', async () => {
    const result = await openDeliveryChannel(action, rep, 'manual');
    expect(result.dispatched).toBe(true);
  });

  it('reports no-contact-url when rep lacks contactUrl', async () => {
    const noUrl = { ...rep, contactUrl: undefined };
    const result = await openDeliveryChannel(action, noUrl, 'manual');
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no-contact-url');
  });
});
