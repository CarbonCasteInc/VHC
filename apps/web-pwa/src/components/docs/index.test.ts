import { describe, expect, it } from 'vitest';
import {
  ArticleEditor, ArticleViewer, ArticleFeedCard,
  PresenceBar, ShareModal, useEditorMode, resolveMode, resolveE2E,
} from './index';

describe('docs barrel export', () => {
  it('exports ArticleEditor', () => { expect(ArticleEditor).toBeDefined(); });
  it('exports ArticleViewer', () => { expect(ArticleViewer).toBeDefined(); });
  it('exports ArticleFeedCard', () => { expect(ArticleFeedCard).toBeDefined(); });
  it('exports PresenceBar', () => { expect(PresenceBar).toBeDefined(); });
  it('exports ShareModal', () => { expect(ShareModal).toBeDefined(); });
  it('exports useEditorMode', () => { expect(useEditorMode).toBeDefined(); });
  it('exports resolveMode', () => { expect(resolveMode).toBeDefined(); });
  it('exports resolveE2E', () => { expect(resolveE2E).toBeDefined(); });
});
