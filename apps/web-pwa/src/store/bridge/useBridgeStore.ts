/**
 * Bridge store — runtime state for civic actions, receipts, and reports.
 *
 * Hydrates from IndexedDB on init, syncs to Gun on write.
 * All runtime gated behind VITE_ELEVATION_ENABLED.
 *
 * Spec: spec-civic-action-kit-v0.md §5, §6
 */

import type { CivicAction, DeliveryReceipt } from '@vh/data-model';
import { CivicActionSchema, DeliveryReceiptSchema } from '@vh/data-model';
import {
  idbGet,
  idbSet,
  actionsKey,
  receiptsKey,
  reportsKey,
} from './bridgeStorage';

/* ── E2E / feature flag ─────────────────────────────────────── */

function isE2E(): boolean {
  /* v8 ignore next 2 -- browser env */
  const v = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_E2E_MODE;
  /* v8 ignore next 2 -- node fallback */
  const n = typeof process !== 'undefined' ? process.env?.VITE_E2E_MODE : undefined;
  return (n ?? v) === 'true';
}

function isElevationEnabled(): boolean {
  /* v8 ignore next 2 -- browser env */
  const v = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ELEVATION_ENABLED;
  /* v8 ignore next 2 -- node fallback */
  const n = typeof process !== 'undefined' ? process.env?.VITE_ELEVATION_ENABLED : undefined;
  return (n ?? v) === 'true';
}

/* ── In-memory state ────────────────────────────────────────── */

const _actions = new Map<string, CivicAction>();
const _receipts = new Map<string, DeliveryReceipt>();
const _reports = new Map<string, { reportId: string; checksum: string }>();
let _hydrated = false;

/* ── Hydration ──────────────────────────────────────────────── */

export async function hydrateBridgeStore(nullifier: string): Promise<void> {
  if (isE2E() || !isElevationEnabled()) return;

  const [rawActions, rawReceipts, rawReports] = await Promise.all([
    idbGet<Record<string, unknown>>(actionsKey(nullifier)),
    idbGet<Record<string, unknown>>(receiptsKey(nullifier)),
    idbGet<Record<string, { reportId: string; checksum: string }>>(reportsKey(nullifier)),
  ]);

  if (rawActions && typeof rawActions === 'object') {
    for (const [id, val] of Object.entries(rawActions)) {
      const parsed = CivicActionSchema.safeParse(val);
      if (parsed.success) _actions.set(id, parsed.data);
    }
  }
  if (rawReceipts && typeof rawReceipts === 'object') {
    for (const [id, val] of Object.entries(rawReceipts)) {
      const parsed = DeliveryReceiptSchema.safeParse(val);
      if (parsed.success) _receipts.set(id, parsed.data);
    }
  }
  if (rawReports && typeof rawReports === 'object') {
    for (const [id, val] of Object.entries(rawReports)) {
      if (val && typeof val.reportId === 'string' && typeof val.checksum === 'string') {
        _reports.set(id, val);
      }
    }
  }
  _hydrated = true;
}

export function isHydrated(): boolean {
  return _hydrated;
}

/* ── Actions ────────────────────────────────────────────────── */

export function getAction(id: string): CivicAction | undefined {
  return _actions.get(id);
}

export function getAllActions(): CivicAction[] {
  return Array.from(_actions.values());
}

export async function createAction(
  nullifier: string,
  action: CivicAction,
): Promise<boolean> {
  const parsed = CivicActionSchema.safeParse(action);
  if (!parsed.success) return false;
  _actions.set(parsed.data.id, parsed.data);
  await persistActions(nullifier);
  return true;
}

export async function updateAction(
  nullifier: string,
  id: string,
  updates: Partial<CivicAction>,
): Promise<boolean> {
  const existing = _actions.get(id);
  if (!existing) return false;
  const merged = { ...existing, ...updates };
  const parsed = CivicActionSchema.safeParse(merged);
  if (!parsed.success) return false;
  _actions.set(id, parsed.data);
  await persistActions(nullifier);
  return true;
}

/* ── Receipts ───────────────────────────────────────────────── */

export function getReceipt(id: string): DeliveryReceipt | undefined {
  return _receipts.get(id);
}

export function getAllReceipts(): DeliveryReceipt[] {
  return Array.from(_receipts.values());
}

export function getReceiptsForAction(actionId: string): DeliveryReceipt[] {
  return Array.from(_receipts.values()).filter((r) => r.actionId === actionId);
}

export async function addReceipt(
  nullifier: string,
  receipt: DeliveryReceipt,
): Promise<boolean> {
  const parsed = DeliveryReceiptSchema.safeParse(receipt);
  if (!parsed.success) return false;
  _receipts.set(parsed.data.id, parsed.data);
  await persistReceipts(nullifier);
  return true;
}

/* ── Reports ────────────────────────────────────────────────── */

export function getReportPointer(id: string): { reportId: string; checksum: string } | undefined {
  return _reports.get(id);
}

export async function addReportPointer(
  nullifier: string,
  reportId: string,
  checksum: string,
): Promise<void> {
  _reports.set(reportId, { reportId, checksum });
  await persistReports(nullifier);
}

/* ── Persistence helpers ────────────────────────────────────── */

async function persistActions(nullifier: string): Promise<void> {
  const obj: Record<string, CivicAction> = {};
  for (const [id, action] of _actions) obj[id] = action;
  await idbSet(actionsKey(nullifier), obj);
}

async function persistReceipts(nullifier: string): Promise<void> {
  const obj: Record<string, DeliveryReceipt> = {};
  for (const [id, receipt] of _receipts) obj[id] = receipt;
  await idbSet(receiptsKey(nullifier), obj);
}

async function persistReports(nullifier: string): Promise<void> {
  const obj: Record<string, { reportId: string; checksum: string }> = {};
  for (const [id, report] of _reports) obj[id] = report;
  await idbSet(reportsKey(nullifier), obj);
}

/* ── Test utilities ─────────────────────────────────────────── */

export function _resetStoreForTesting(): void {
  _actions.clear();
  _receipts.clear();
  _reports.clear();
  _hydrated = false;
}
