/**
 * Gun bridge adapters — civic action + receipt persistence and aggregate stats.
 *
 * Write paths:
 * - Auth: ~<devicePub>/hermes/bridge/actions/<actionId>
 * - Auth: ~<devicePub>/hermes/bridge/receipts/<receiptId>
 * - Public: vh/bridge/stats/<repId>
 *
 * Spec: spec-civic-action-kit-v0.md §5.2, §5.3
 */

import type { CivicAction, DeliveryReceipt } from '@vh/data-model';
import { CivicActionSchema, DeliveryReceiptSchema } from '@vh/data-model';
import type { VennClient } from './types';

/* ── PII strip filter ───────────────────────────────────────── */

/**
 * Fields that must never appear in stored records.
 * Matches FORBIDDEN_PUBLIC_FIELDS from accountStore.
 */
const FORBIDDEN_KEYS = new Set([
  'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token',
  'bearer', 'bearertoken', 'bearer_token',
  'providersecret', 'provider_secret', 'secret',
  'privatemessagebody', 'private_message_body',
  'token',
]);

/**
 * Check if an object contains any forbidden PII keys (recursive).
 * Returns the first forbidden key found, or null if clean.
 */
export function findForbiddenKey(
  obj: unknown,
  visited = new WeakSet<object>(),
): string | null {
  if (obj === null || obj === undefined || typeof obj !== 'object') return null;
  const target = obj as Record<string, unknown>;
  if (visited.has(target)) return null;
  visited.add(target);

  for (const key of Object.keys(target)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return key;
    const value = target[key];
    if (typeof value === 'object' && value !== null) {
      const found = findForbiddenKey(value, visited);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Strip undefined values from an object (Gun rejects undefined in puts).
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/* ── Chain accessors ────────────────────────────────────────── */

export function getUserActionsChain(client: VennClient, actionId: string) {
  return (client.gun.user() as any).get('hermes').get('bridge').get('actions').get(actionId);
}

export function getUserReceiptsChain(client: VennClient, receiptId: string) {
  return (client.gun.user() as any).get('hermes').get('bridge').get('receipts').get(receiptId);
}

export function getRepStatsChain(client: VennClient, repId: string) {
  return client.gun.get('vh').get('bridge').get('stats').get(repId);
}

/* ── Write operations ───────────────────────────────────────── */

/**
 * Save a civic action to the authenticated user graph.
 * Validates with Zod, strips PII, rejects forbidden fields.
 * Spec: spec-civic-action-kit-v0.md §5.2
 */
export async function saveAction(
  client: VennClient,
  action: CivicAction,
): Promise<void> {
  const parsed = CivicActionSchema.parse(action);
  const forbidden = findForbiddenKey(parsed);
  /* v8 ignore next 3 -- defense-in-depth; strict Zod rejects unknown keys first */
  if (forbidden) {
    throw new Error(`PII field rejected: ${forbidden}`);
  }
  const clean = stripUndefined(parsed as unknown as Record<string, unknown>);
  const chain = getUserActionsChain(client, parsed.id);
  return new Promise<void>((resolve, reject) => {
    chain.put(clean, ((ack: { err?: string } | undefined) => {
      if (ack?.err) reject(new Error(ack.err));
      else resolve();
    }) as any);
  });
}

/**
 * Save a delivery receipt to the authenticated user graph.
 * Validates with Zod, strips PII, rejects forbidden fields.
 * Spec: spec-civic-action-kit-v0.md §5.2
 */
export async function saveReceipt(
  client: VennClient,
  receipt: DeliveryReceipt,
): Promise<void> {
  const parsed = DeliveryReceiptSchema.parse(receipt);
  const forbidden = findForbiddenKey(parsed);
  /* v8 ignore next 3 -- defense-in-depth; strict Zod rejects unknown keys first */
  if (forbidden) {
    throw new Error(`PII field rejected: ${forbidden}`);
  }
  const clean = stripUndefined(parsed as unknown as Record<string, unknown>);
  const chain = getUserReceiptsChain(client, parsed.id);
  return new Promise<void>((resolve, reject) => {
    chain.put(clean, ((ack: { err?: string } | undefined) => {
      if (ack?.err) reject(new Error(ack.err));
      else resolve();
    }) as any);
  });
}

/* ── Report operations ──────────────────────────────────────── */

export function getUserReportsChain(client: VennClient, reportId: string) {
  return (client.gun.user() as any).get('hermes').get('bridge').get('reports').get(reportId);
}

/**
 * Save a report pointer/checksum to the authenticated user graph.
 * Spec: spec-civic-action-kit-v0.md §5.1 (reports topology)
 */
export async function saveReport(
  client: VennClient,
  reportId: string,
  pointer: { checksum: string; actionId: string; generatedAt: number },
): Promise<void> {
  const clean = stripUndefined({ reportId, ...pointer } as Record<string, unknown>);
  const chain = getUserReportsChain(client, reportId);
  return new Promise<void>((resolve, reject) => {
    chain.put(clean, ((ack: { err?: string } | undefined) => {
      if (ack?.err) reject(new Error(ack.err));
      else resolve();
    }) as any);
  });
}

/**
 * Load a report pointer from the authenticated user graph.
 */
export async function loadReport(
  client: VennClient,
  reportId: string,
): Promise<{ reportId: string; checksum: string; actionId: string; generatedAt: number } | null> {
  const chain = getUserReportsChain(client, reportId);
  return new Promise((resolve) => {
    chain.once((data: any) => {
      if (data && typeof data === 'object' && typeof data.checksum === 'string') {
        resolve(data as { reportId: string; checksum: string; actionId: string; generatedAt: number });
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Increment anonymous aggregate stats for a representative.
 * Public path: vh/bridge/stats/<repId>
 * Spec: spec-civic-action-kit-v0.md §5.3
 */
export async function incrementRepStats(
  client: VennClient,
  repId: string,
): Promise<void> {
  const chain = getRepStatsChain(client, repId);

  // Read current count, increment, write back
  return new Promise<void>((resolve, reject) => {
    chain.once((data: any) => {
      const currentCount = typeof data?.count === 'number' ? data.count : 0;
      const update = { count: currentCount + 1, lastActivity: Date.now() };
      chain.put(update, ((ack: { err?: string } | undefined) => {
        if (ack?.err) reject(new Error(ack.err));
        else resolve();
      }) as any);
    });
  });
}
