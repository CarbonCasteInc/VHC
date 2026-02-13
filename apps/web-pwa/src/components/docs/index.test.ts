import { describe, expect, it } from 'vitest';
import { ArticleEditor, ArticleViewer, ArticleFeedCard } from './index';

describe('docs barrel export', () => {
  it('exports ArticleEditor', () => {
    expect(ArticleEditor).toBeDefined();
  });

  it('exports ArticleViewer', () => {
    expect(ArticleViewer).toBeDefined();
  });

  it('exports ArticleFeedCard', () => {
    expect(ArticleFeedCard).toBeDefined();
  });
});
