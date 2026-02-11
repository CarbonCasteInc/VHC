/**
 * HERMES Docs Store — Stage 1 (single-author, no CRDT)
 *
 * Zustand store for HermesDocument CRUD: createDraft, saveDraft,
 * publishArticle, getDraft, listDrafts.
 *
 * Feature flag: VITE_HERMES_DOCS_ENABLED (default false).
 * Drafts are private by default — no publish side effects on create/save.
 */

import { create } from 'zustand';
import { HermesDocumentSchema, type HermesDocument } from '@vh/data-model';

// ── Feature flag ──────────────────────────────────────────────────────
const DOCS_ENABLED =
  typeof import.meta !== 'undefined' &&
  (import.meta as any).env?.VITE_HERMES_DOCS_ENABLED === 'true';

// ── Types ─────────────────────────────────────────────────────────────

export interface SourceContext {
  sourceTopicId?: string;
  sourceSynthesisId?: string;
  sourceEpoch?: number;
  sourceThreadId?: string;
}

export interface DocsState {
  documents: Map<string, HermesDocument>;
  enabled: boolean;
  createDraft: (fromReplyText: string, sourceContext?: SourceContext) => HermesDocument | null;
  saveDraft: (docId: string, updates: Partial<Pick<HermesDocument, 'title' | 'encryptedContent' | 'type'>>) => void;
  publishArticle: (docId: string) => void;
  getDraft: (docId: string) => HermesDocument | undefined;
  listDrafts: () => HermesDocument[];
  listPublished: () => HermesDocument[];
}

export interface DocsDeps {
  now: () => number;
  randomId: () => string;
  owner: () => string;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** @internal exported for testing only */
export function defaultRandomId(): string {
  /* v8 ignore next 3 -- fallback for environments without crypto.randomUUID */
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    return `${Date.now()}-${Math.random()}`;
  }
  return crypto.randomUUID();
}

// ── Factory ───────────────────────────────────────────────────────────

export function createDocsStore(overrides?: Partial<DocsDeps>, forceEnabled?: boolean) {
  const enabled = forceEnabled ?? DOCS_ENABLED;

  const deps: DocsDeps = {
    now: overrides?.now ?? (() => Date.now()),
    randomId: overrides?.randomId ?? defaultRandomId,
    owner: overrides?.owner ?? (() => 'anonymous'),
  };

  return create<DocsState>((set, get) => ({
    documents: new Map(),
    enabled,

    createDraft(fromReplyText: string, sourceContext?: SourceContext): HermesDocument | null {
      if (!get().enabled) return null;

      const now = deps.now();
      const id = deps.randomId();
      const ownerValue = deps.owner();

      const doc: HermesDocument = HermesDocumentSchema.parse({
        id,
        schemaVersion: 'hermes-document-v0',
        title: 'Untitled',
        type: 'article',
        owner: ownerValue,
        collaborators: [],
        encryptedContent: fromReplyText,
        createdAt: now,
        lastModifiedAt: now,
        lastModifiedBy: ownerValue,
        ...(sourceContext?.sourceTopicId ? { sourceTopicId: sourceContext.sourceTopicId } : {}),
        ...(sourceContext?.sourceSynthesisId ? { sourceSynthesisId: sourceContext.sourceSynthesisId } : {}),
        ...(sourceContext?.sourceEpoch != null ? { sourceEpoch: sourceContext.sourceEpoch } : {}),
        ...(sourceContext?.sourceThreadId ? { sourceThreadId: sourceContext.sourceThreadId } : {}),
      });

      set((state) => {
        const next = new Map(state.documents);
        next.set(id, doc);
        return { documents: next };
      });

      return doc;
    },

    saveDraft(docId: string, updates: Partial<Pick<HermesDocument, 'title' | 'encryptedContent' | 'type'>>) {
      if (!get().enabled) return;

      set((state) => {
        const existing = state.documents.get(docId);
        if (!existing) return state;
        if (existing.publishedAt != null) return state; // cannot edit published

        const updated: HermesDocument = {
          ...existing,
          ...updates,
          lastModifiedAt: deps.now(),
        };
        const next = new Map(state.documents);
        next.set(docId, updated);
        return { documents: next };
      });
    },

    publishArticle(docId: string) {
      if (!get().enabled) return;

      set((state) => {
        const existing = state.documents.get(docId);
        if (!existing) return state;
        if (existing.publishedAt != null) return state; // already published

        const published: HermesDocument = {
          ...existing,
          publishedAt: deps.now(),
          publishedArticleId: deps.randomId(),
          lastModifiedAt: deps.now(),
        };
        const next = new Map(state.documents);
        next.set(docId, published);
        return { documents: next };
      });
    },

    getDraft(docId: string): HermesDocument | undefined {
      return get().documents.get(docId);
    },

    listDrafts(): HermesDocument[] {
      return Array.from(get().documents.values()).filter((d) => d.publishedAt == null);
    },

    listPublished(): HermesDocument[] {
      return Array.from(get().documents.values()).filter((d) => d.publishedAt != null);
    },
  }));
}

// ── Default singleton (gated by feature flag) ─────────────────────────

export const useDocsStore = createDocsStore();

// ── Mock factory (for E2E) ────────────────────────────────────────────

export function createMockHermesDocsStore(overrides?: Partial<DocsDeps>) {
  return createDocsStore(
    {
      now: overrides?.now ?? (() => Date.now()),
      randomId: overrides?.randomId ?? (() => `mock-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      owner: overrides?.owner ?? (() => 'mock-owner'),
    },
    true, // force enabled
  );
}
