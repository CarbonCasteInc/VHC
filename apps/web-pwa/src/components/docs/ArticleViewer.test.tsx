/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ArticleViewer } from './ArticleViewer';

// ── Mock store ────────────────────────────────────────────────────────

const publishedDoc = {
  id: 'doc-published',
  schemaVersion: 'hermes-document-v0',
  title: 'Published Article',
  type: 'article',
  owner: 'alice',
  collaborators: [],
  encryptedContent: 'This is the article body.',
  createdAt: 1_700_000_000_000,
  lastModifiedAt: 1_700_000_001_000,
  lastModifiedBy: 'alice',
  publishedAt: 1_700_000_001_000,
  publishedArticleId: 'pub-1',
  sourceTopicId: 'topic-42',
  sourceThreadId: 'thread-7',
};

const draftDoc = {
  id: 'doc-draft',
  schemaVersion: 'hermes-document-v0',
  title: 'Draft Article',
  type: 'draft',
  owner: 'bob',
  collaborators: [],
  encryptedContent: 'Draft content.',
  createdAt: 1_700_000_000_000,
  lastModifiedAt: 1_700_000_000_000,
  lastModifiedBy: 'bob',
};

const docs = new Map([
  ['doc-published', publishedDoc],
  ['doc-draft', draftDoc],
]);

let mockEnabled = true;

vi.mock('../../store/hermesDocs', () => ({
  useDocsStore: (selector?: any) => {
    const state = {
      enabled: mockEnabled,
      getDraft: (id: string) => docs.get(id),
      documents: docs,
      createDraft: vi.fn(),
      saveDraft: vi.fn(),
      publishArticle: vi.fn(),
      listDrafts: vi.fn(() => []),
    };
    return selector ? selector(state) : state;
  },
}));

describe('ArticleViewer', () => {
  afterEach(() => {
    cleanup();
    mockEnabled = true;
  });

  it('renders published article with all fields', () => {
    render(<ArticleViewer docId="doc-published" />);
    expect(screen.getByTestId('article-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('article-title')).toHaveTextContent('Published Article');
    expect(screen.getByTestId('article-content')).toHaveTextContent('This is the article body.');
    expect(screen.getByTestId('article-meta')).toHaveTextContent('article');
    expect(screen.getByTestId('article-meta')).toHaveTextContent('alice');
    expect(screen.getByTestId('article-source')).toHaveTextContent('topic-42');
    expect(screen.getByTestId('article-source')).toHaveTextContent('thread-7');
  });

  it('renders draft article without publish date', () => {
    render(<ArticleViewer docId="doc-draft" />);
    expect(screen.getByTestId('article-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('article-title')).toHaveTextContent('Draft Article');
    expect(screen.getByTestId('article-meta')).not.toHaveTextContent('Published');
  });

  it('shows not-found for missing docId', () => {
    render(<ArticleViewer docId="non-existent" />);
    expect(screen.getByTestId('article-not-found')).toBeInTheDocument();
    expect(screen.getByTestId('article-not-found')).toHaveTextContent('Article not found');
  });

  it('returns null when feature is disabled', () => {
    mockEnabled = false;
    const { container } = render(<ArticleViewer docId="doc-published" />);
    expect(container.innerHTML).toBe('');
  });

  it('does not show source linkage when not present', () => {
    render(<ArticleViewer docId="doc-draft" />);
    expect(screen.queryByTestId('article-source')).not.toBeInTheDocument();
  });
});
