/**
 * Append-only audit log for beta invite gating.
 * Logs critical gating actions to localStorage.
 */
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';

const AUDIT_LOG_KEY = 'vh_audit_log';
const MAX_ENTRIES = 1000;

export type AuditAction =
  | 'invite_created'
  | 'invite_redeemed'
  | 'invite_revoked'
  | 'invite_validation_failed'
  | 'identity_created'
  | 'identity_blocked'
  | 'rate_limit_hit'
  | 'kill_switch_toggled'
  | 'gating_check';

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly action: AuditAction;
  readonly details: Record<string, unknown>;
}

export interface AuditLogStore {
  entries: AuditEntry[];
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID() as string;
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadAuditLog(): AuditLogStore {
  try {
    const raw = safeGetItem(AUDIT_LOG_KEY);
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw) as AuditLogStore;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

export function persistAuditLog(store: AuditLogStore): void {
  safeSetItem(AUDIT_LOG_KEY, JSON.stringify(store));
}

export function appendAuditEntry(
  action: AuditAction,
  details: Record<string, unknown>,
  now?: number,
): AuditEntry {
  const entry: AuditEntry = {
    id: generateId(),
    timestamp: now ?? Date.now(),
    action,
    details,
  };
  const store = loadAuditLog();
  store.entries.push(entry);

  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(store.entries.length - MAX_ENTRIES);
  }

  persistAuditLog(store);
  return entry;
}

export function getAuditEntries(
  filter?: { action?: AuditAction; since?: number; limit?: number },
): AuditEntry[] {
  const store = loadAuditLog();
  let entries = store.entries;

  if (filter?.action) {
    entries = entries.filter((e) => e.action === filter.action);
  }
  if (filter?.since) {
    const since = filter.since;
    entries = entries.filter((e) => e.timestamp >= since);
  }
  if (filter?.limit) {
    entries = entries.slice(-filter.limit);
  }

  return entries;
}

export function clearAuditLog(): void {
  persistAuditLog({ entries: [] });
}
