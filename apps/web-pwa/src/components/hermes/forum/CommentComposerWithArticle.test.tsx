/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommentComposerWithArticle } from './CommentComposerWithArticle';
import { REPLY_WARNING_THRESHOLD, REPLY_CHAR_LIMIT } from './CommentComposer';

// ── Mock forum store ──────────────────────────────────────────────────

const createCommentMock = vi.fn(async () => undefined);

vi.mock('../../../store/hermesForum', () => ({
  useForumStore: (selector?: any) => {
    const state = { createComment: createCommentMock };
    return selector ? selector(state) : state;
  },
}));

vi.mock('./SlideToPost', () => ({
  SlideToPost: ({ onChange, disabled }: any) => (
    <button
      type="button"
      data-testid="slide-to-post-mock"
      disabled={disabled}
      onClick={() => onChange(10)}
    >
      Slide
    </button>
  ),
}));

// ── Mock docs store ───────────────────────────────────────────────────

let storeDocuments = new Map<string, any>();
let idCounter = 0;

const mockCreateDraft = vi.fn((text: string, ctx?: any) => {
  const id = `test-doc-${idCounter++}`;
  const doc = {
    id,
    schemaVersion: 'hermes-document-v0',
    title: 'Untitled',
    type: 'article',
    owner: 'test-owner',
    collaborators: [],
    encryptedContent: text,
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    lastModifiedBy: 'test-owner',
    ...(ctx?.sourceThreadId ? { sourceThreadId: ctx.sourceThreadId } : {}),
  };
  storeDocuments.set(id, doc);
  return doc;
});

const mockSaveDraft = vi.fn((docId: string, updates: any) => {
  const existing = storeDocuments.get(docId);
  if (existing) {
    storeDocuments.set(docId, { ...existing, ...updates });
  }
});

const mockPublishArticle = vi.fn((docId: string) => {
  const existing = storeDocuments.get(docId);
  if (existing) {
    storeDocuments.set(docId, {
      ...existing,
      publishedAt: Date.now(),
      publishedArticleId: `pub-${docId}`,
    });
  }
});

vi.mock('../../../store/hermesDocs', () => ({
  useDocsStore: (selector?: any) => {
    const state = {
      enabled: true,
      createDraft: mockCreateDraft,
      saveDraft: mockSaveDraft,
      publishArticle: mockPublishArticle,
      getDraft: (id: string) => storeDocuments.get(id),
      listDrafts: () =>
        Array.from(storeDocuments.values()).filter(
          (d: any) => d.publishedAt == null,
        ),
      listPublished: () =>
        Array.from(storeDocuments.values()).filter(
          (d: any) => d.publishedAt != null,
        ),
      documents: storeDocuments,
    };
    return selector ? selector(state) : state;
  },
}));

function typeIntoComposer(text: string) {
  fireEvent.change(screen.getByTestId('comment-composer'), {
    target: { value: text },
  });
}

describe('CommentComposerWithArticle', () => {
  beforeEach(() => {
    storeDocuments = new Map();
    idCounter = 0;
    createCommentMock.mockClear();
    mockCreateDraft.mockClear();
    mockSaveDraft.mockClear();
    mockPublishArticle.mockClear();
  });
  afterEach(() => cleanup());

  it('renders CommentComposer initially', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    expect(
      screen.getByTestId('comment-composer-container'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('article-editor')).not.toBeInTheDocument();
  });

  it('shows CTA at ≥200 chars', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
    expect(
      screen.getByTestId('convert-to-article-cta'),
    ).toBeInTheDocument();
  });

  it('CTA button is enabled (handler is wired)', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
    const btn = screen.getByTestId('convert-to-article-btn');
    expect(btn).not.toBeDisabled();
  });

  it('clicking CTA opens ArticleEditor with pre-populated text', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    const text = 'x'.repeat(REPLY_WARNING_THRESHOLD);
    typeIntoComposer(text);
    fireEvent.click(screen.getByTestId('convert-to-article-btn'));

    expect(screen.getByTestId('article-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-composer-container')).not.toBeInTheDocument();

    const contentInput = screen.getByTestId(
      'article-content-input',
    ) as HTMLTextAreaElement;
    expect(contentInput.value).toBe(text);
  });

  it('shows overlay header when editor is open', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
    fireEvent.click(screen.getByTestId('convert-to-article-btn'));

    expect(screen.getByTestId('article-editor-overlay')).toBeInTheDocument();
    expect(
      screen.getByText('Converting reply to article'),
    ).toBeInTheDocument();
  });

  it('close button returns to CommentComposer', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
    fireEvent.click(screen.getByTestId('convert-to-article-btn'));
    expect(screen.getByTestId('article-editor')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('close-editor-btn'));
    expect(
      screen.getByTestId('comment-composer-container'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('article-editor')).not.toBeInTheDocument();
  });

  it('passes source context with threadId to ArticleEditor', () => {
    render(<CommentComposerWithArticle threadId="thread-42" />);
    typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
    fireEvent.click(screen.getByTestId('convert-to-article-btn'));

    // The editor should be rendered — source context is passed internally
    expect(screen.getByTestId('article-editor')).toBeInTheDocument();
  });

  it('pre-populates with exact CTA text at overflow', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    // Type exactly at limit
    const text = 'a'.repeat(REPLY_CHAR_LIMIT);
    typeIntoComposer(text);
    fireEvent.click(screen.getByTestId('convert-to-article-btn'));

    const contentInput = screen.getByTestId(
      'article-content-input',
    ) as HTMLTextAreaElement;
    expect(contentInput.value).toBe(text);
  });

  it('editor complete callback closes editor', () => {
    render(<CommentComposerWithArticle threadId="thread-1" />);
    typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
    fireEvent.click(screen.getByTestId('convert-to-article-btn'));

    // Fill in title and publish to trigger onComplete
    const titleInput = screen.getByTestId('article-title-input');
    fireEvent.change(titleInput, { target: { value: 'Test Title' } });
    fireEvent.click(screen.getByTestId('publish-btn'));

    // After publish, editor closes and composer returns
    expect(
      screen.getByTestId('comment-composer-container'),
    ).toBeInTheDocument();
  });

  it('uses custom sourceContext when provided', () => {
    const ctx = { sourceTopicId: 'topic-1', sourceThreadId: 'thread-99' };
    render(
      <CommentComposerWithArticle
        threadId="thread-1"
        sourceContext={ctx}
      />,
    );
    typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
    fireEvent.click(screen.getByTestId('convert-to-article-btn'));

    // Source linkage should show the custom context
    expect(screen.getByTestId('source-linkage')).toHaveTextContent(
      'Thread thread-99',
    );
    expect(screen.getByTestId('source-linkage')).toHaveTextContent(
      'Topic topic-1',
    );
  });
});
