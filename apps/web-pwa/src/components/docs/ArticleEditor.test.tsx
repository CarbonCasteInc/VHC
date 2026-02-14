/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArticleEditor, TITLE_MAX, CONTENT_MAX } from './ArticleEditor';
import { REPLY_CHAR_LIMIT } from '../hermes/forum/CommentComposer';

// ── Mock store ────────────────────────────────────────────────────────

let storeDocuments = new Map<string, any>();
let idCounter = 0;

const mockCreateDraft = vi.fn((text: string, ctx?: any) => {
  const id = `test-doc-${idCounter++}`;
  const doc = {
    id, schemaVersion: 'hermes-document-v0', title: 'Untitled', type: 'article',
    owner: 'test-owner', collaborators: [], encryptedContent: text,
    createdAt: Date.now(), lastModifiedAt: Date.now(), lastModifiedBy: 'test-owner',
    ...(ctx?.sourceTopicId ? { sourceTopicId: ctx.sourceTopicId } : {}),
    ...(ctx?.sourceThreadId ? { sourceThreadId: ctx.sourceThreadId } : {}),
    ...(ctx?.sourceSynthesisId ? { sourceSynthesisId: ctx.sourceSynthesisId } : {}),
  };
  storeDocuments.set(id, doc);
  return doc;
});

const mockSaveDraft = vi.fn((docId: string, updates: any) => {
  const existing = storeDocuments.get(docId);
  if (existing) storeDocuments.set(docId, { ...existing, ...updates, lastModifiedAt: Date.now() });
});

const mockPublishArticle = vi.fn((docId: string) => {
  const existing = storeDocuments.get(docId);
  if (existing) storeDocuments.set(docId, {
    ...existing, publishedAt: Date.now(), publishedArticleId: `pub-${docId}`,
  });
});

const mockGetDraft = vi.fn((docId: string) => storeDocuments.get(docId));

vi.mock('../../store/hermesDocs', () => ({
  useDocsStore: (selector?: any) => {
    const state = {
      enabled: true, createDraft: mockCreateDraft, saveDraft: mockSaveDraft,
      publishArticle: mockPublishArticle, getDraft: mockGetDraft,
      listDrafts: () => Array.from(storeDocuments.values()), documents: storeDocuments,
    };
    return selector ? selector(state) : state;
  },
}));

// Mock CollabEditor (lazy-loaded) — returns a simple div
vi.mock('./CollabEditor', () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="collab-editor" data-doc-id={props.docId}
      data-nullifier={props.myNullifier}
      data-collaborators={JSON.stringify(props.collaborators)}
      data-e2e={String(props.e2eMode)}>
      collab-editor-mock
    </div>
  ),
}));

// Mock ShareModal (lazy-loaded)
vi.mock('./ShareModal', () => ({
  ShareModal: (props: any) => (
    props.isOpen ? <div data-testid="share-modal-mock">share-modal</div> : null
  ),
}));

describe('ArticleEditor', () => {
  beforeEach(() => {
    storeDocuments = new Map();
    idCounter = 0;
    mockCreateDraft.mockClear();
    mockSaveDraft.mockClear();
    mockPublishArticle.mockClear();
    mockGetDraft.mockClear();
  });
  afterEach(() => cleanup());

  // ── Stage 1 textarea mode (flag off) ──

  describe('textarea mode (flags off)', () => {
    it('renders textarea when collab flag is off', () => {
      render(<ArticleEditor initialContent="content" _collabEnabled={false} />);
      expect(screen.getByTestId('article-content-input')).toBeInTheDocument();
      expect(screen.queryByTestId('collab-editor')).not.toBeInTheDocument();
      expect(screen.queryByTestId('share-btn')).not.toBeInTheDocument();
    });

    it('renders textarea when docs flag is off', () => {
      render(<ArticleEditor initialContent="content" _docsEnabled={false} _collabEnabled={true} />);
      expect(screen.getByTestId('article-content-input')).toBeInTheDocument();
      expect(screen.queryByTestId('collab-editor')).not.toBeInTheDocument();
    });

    it('preserves textarea even when doc has collaborators and collab off', () => {
      render(
        <ArticleEditor initialContent="content" collaborators={['peer-1']}
          _docsEnabled={true} _collabEnabled={false} />,
      );
      expect(screen.getByTestId('article-content-input')).toBeInTheDocument();
      expect(screen.queryByTestId('collab-editor')).not.toBeInTheDocument();
    });

    it('does not import CollabEditor when collab off (no lazy load)', () => {
      render(<ArticleEditor initialContent="content" _collabEnabled={false} />);
      expect(screen.queryByTestId('collab-loading')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collab-editor')).not.toBeInTheDocument();
    });
  });

  // ── Collab mode (both flags on) ──

  describe('collab mode (both flags on)', () => {
    const collabProps = {
      myNullifier: 'user-abc',
      collaborators: ['peer-1', 'peer-2'],
      _docsEnabled: true,
      _collabEnabled: true,
      _e2eMode: true,
    };

    it('renders CollabEditor when both flags on and docId set', async () => {
      render(<ArticleEditor initialContent="content" {...collabProps} />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'Title' } });
      fireEvent.click(screen.getByTestId('save-draft-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('collab-editor')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('article-content-input')).not.toBeInTheDocument();
    });

    it('shows Share button in collab mode after save', async () => {
      render(<ArticleEditor initialContent="content" {...collabProps} />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'Title' } });
      fireEvent.click(screen.getByTestId('save-draft-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('share-btn')).toBeInTheDocument();
      });
    });

    it('opens ShareModal when Share clicked', async () => {
      render(<ArticleEditor initialContent="content" {...collabProps} />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'Title' } });
      fireEvent.click(screen.getByTestId('save-draft-btn'));
      await waitFor(() => screen.getByTestId('share-btn'));
      fireEvent.click(screen.getByTestId('share-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('share-modal-mock')).toBeInTheDocument();
      });
    });

    it('passes correct props to CollabEditor', async () => {
      render(<ArticleEditor initialContent="content" {...collabProps} />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'T' } });
      fireEvent.click(screen.getByTestId('save-draft-btn'));
      await waitFor(() => screen.getByTestId('collab-editor'));
      const ce = screen.getByTestId('collab-editor');
      expect(ce.getAttribute('data-doc-id')).toBe('test-doc-0');
      expect(ce.getAttribute('data-nullifier')).toBe('user-abc');
      expect(ce.getAttribute('data-collaborators')).toBe('["peer-1","peer-2"]');
      expect(ce.getAttribute('data-e2e')).toBe('true');
    });

    it('still shows textarea before first save (no docId yet)', () => {
      render(<ArticleEditor initialContent="content" {...collabProps} />);
      expect(screen.getByTestId('article-content-input')).toBeInTheDocument();
      expect(screen.queryByTestId('collab-editor')).not.toBeInTheDocument();
    });
  });

  // ── Stage 1 behavior parity (unchanged) ──

  describe('Stage 1 parity', () => {
    it('renders with pre-populated text from CTA', () => {
      render(<ArticleEditor initialContent="overflow text from reply" />);
      expect(screen.getByTestId('article-editor')).toBeInTheDocument();
      const content = screen.getByTestId('article-content-input') as HTMLTextAreaElement;
      expect(content.value).toBe('overflow text from reply');
    });

    it('renders heading "New Article" initially', () => {
      render(<ArticleEditor />);
      expect(screen.getByTestId('editor-heading')).toHaveTextContent('New Article');
    });

    it('enforces title ≤200 chars', () => {
      render(<ArticleEditor initialContent="content" />);
      const input = screen.getByTestId('article-title-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'x'.repeat(TITLE_MAX + 50) } });
      expect(input.value.length).toBe(TITLE_MAX);
    });

    it('shows title counter', () => {
      render(<ArticleEditor initialContent="content" />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'Hello' } });
      expect(screen.getByTestId('title-counter')).toHaveTextContent(`5/${TITLE_MAX}`);
    });

    it('enforces content ≤500,000 chars', () => {
      render(<ArticleEditor />);
      const textarea = screen.getByTestId('article-content-input') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'x'.repeat(CONTENT_MAX + 10) } });
      expect(textarea.value.length).toBe(CONTENT_MAX);
    });

    it('shows content counter', () => {
      render(<ArticleEditor initialContent="hello" />);
      expect(screen.getByTestId('content-counter')).toHaveTextContent(/5\/500,000/);
    });

    it('creates store entry on first save', () => {
      render(<ArticleEditor initialContent="my article" />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'My Title' } });
      fireEvent.click(screen.getByTestId('save-draft-btn'));
      expect(mockCreateDraft).toHaveBeenCalledWith('my article', undefined);
      expect(mockSaveDraft).toHaveBeenCalled();
    });

    it('save button disabled without title', () => {
      render(<ArticleEditor initialContent="content" />);
      expect(screen.getByTestId('save-draft-btn')).toBeDisabled();
    });

    it('save button disabled without content', () => {
      render(<ArticleEditor />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'Title' } });
      expect(screen.getByTestId('save-draft-btn')).toBeDisabled();
    });

    it('sets publishedAt on publish', () => {
      render(<ArticleEditor initialContent="content" />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'My Article' } });
      fireEvent.click(screen.getByTestId('publish-btn'));
      expect(mockCreateDraft).toHaveBeenCalled();
      expect(mockPublishArticle).toHaveBeenCalled();
      expect(screen.getByTestId('published-banner')).toBeInTheDocument();
    });

    it('calls onComplete with docId after publish', () => {
      const onComplete = vi.fn();
      render(<ArticleEditor initialContent="content" onComplete={onComplete} />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'Title' } });
      fireEvent.click(screen.getByTestId('publish-btn'));
      expect(onComplete).toHaveBeenCalledWith('test-doc-0');
    });

    it('passes source context to createDraft', () => {
      const ctx = { sourceTopicId: 'topic-1', sourceThreadId: 'thread-1', sourceSynthesisId: 'synth-1' };
      render(<ArticleEditor initialContent="content" sourceContext={ctx} />);
      fireEvent.change(screen.getByTestId('article-title-input'), { target: { value: 'Title' } });
      fireEvent.click(screen.getByTestId('save-draft-btn'));
      expect(mockCreateDraft).toHaveBeenCalledWith('content', ctx);
    });

    it('displays source linkage info when provided', () => {
      const ctx = { sourceTopicId: 'topic-1', sourceThreadId: 'thread-1' };
      render(<ArticleEditor initialContent="content" sourceContext={ctx} />);
      expect(screen.getByTestId('source-linkage')).toHaveTextContent('Thread thread-1');
      expect(screen.getByTestId('source-linkage')).toHaveTextContent('Topic topic-1');
    });

    it('defaults document type to article', () => {
      render(<ArticleEditor initialContent="content" />);
      expect((screen.getByTestId('doc-type-select') as HTMLSelectElement).value).toBe('article');
    });

    it('allows changing document type', () => {
      render(<ArticleEditor initialContent="content" />);
      fireEvent.change(screen.getByTestId('doc-type-select'), { target: { value: 'proposal' } });
      expect((screen.getByTestId('doc-type-select') as HTMLSelectElement).value).toBe('proposal');
    });
  });

  // ── Constants ──

  describe('constants', () => {
    it('exports correct limits', () => {
      expect(TITLE_MAX).toBe(200);
      expect(CONTENT_MAX).toBe(500_000);
    });
  });
});
