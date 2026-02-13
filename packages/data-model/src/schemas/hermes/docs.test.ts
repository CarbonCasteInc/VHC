import { describe, expect, it } from 'vitest';
import {
  DOC_MAX_COLLABORATORS,
  DOC_MAX_VIEWERS,
  DOC_TITLE_LIMIT,
  DocPublishLinkSchema,
  DocumentKeyShareSchema,
  DocumentOperationSchema,
  DocumentTypeSchema,
  HermesDocumentSchema
} from './docs';

const now = Date.now();

const baseDocument = {
  id: 'doc-1',
  schemaVersion: 'hermes-document-v0' as const,
  title: 'Draft article',
  type: 'draft' as const,
  owner: 'alice-nullifier',
  collaborators: [],
  encryptedContent: 'SEA-encrypted-content',
  createdAt: now - 5000,
  lastModifiedAt: now,
  lastModifiedBy: 'alice-nullifier'
};

const baseOperation = {
  id: 'op-1',
  schemaVersion: 'hermes-doc-op-v0' as const,
  docId: 'doc-1',
  encryptedDelta: 'SEA-encrypted-delta',
  author: 'alice-nullifier',
  timestamp: now,
  vectorClock: { 'alice-nullifier': 1 }
};

const baseKeyShare = {
  schemaVersion: 'hermes-doc-key-v0' as const,
  docId: 'doc-1',
  encryptedKey: 'SEA-encrypted-key',
  ownerNullifier: 'alice-nullifier',
  collaboratorNullifier: 'bob-nullifier',
  sharedAt: now
};

const basePublishLink = {
  docId: 'doc-1',
  topicId: 'topic-1',
  articleId: 'article-1',
  publishedAt: now
};

describe('DocumentTypeSchema', () => {
  it.each(['draft', 'proposal', 'report', 'letter', 'article'] as const)(
    'accepts valid type: %s',
    (type) => {
      expect(DocumentTypeSchema.parse(type)).toBe(type);
    }
  );

  it('rejects invalid type', () => {
    expect(DocumentTypeSchema.safeParse('blogpost').success).toBe(false);
  });
});

describe('HermesDocumentSchema', () => {
  it('accepts a minimal valid document', () => {
    const parsed = HermesDocumentSchema.parse(baseDocument);
    expect(parsed.id).toBe('doc-1');
    expect(parsed.type).toBe('draft');
    expect(parsed.collaborators).toEqual([]);
  });

  it('accepts document with all optional fields', () => {
    const full = {
      ...baseDocument,
      type: 'article' as const,
      viewers: ['viewer-1'],
      sourceTopicId: 'topic-1',
      sourceSynthesisId: 'synth-1',
      sourceEpoch: 3,
      sourceThreadId: 'thread-1',
      publishedArticleId: 'art-1',
      publishedAt: now,
      elevatedToThreadId: 'thread-e1',
      elevatedToProposalThreadId: 'thread-p1',
      elevatedToActionId: 'action-1'
    };
    const parsed = HermesDocumentSchema.parse(full);
    expect(parsed.sourceTopicId).toBe('topic-1');
    expect(parsed.publishedArticleId).toBe('art-1');
    expect(parsed.elevatedToThreadId).toBe('thread-e1');
  });

  it('rejects title exceeding limit', () => {
    const result = HermesDocumentSchema.safeParse({
      ...baseDocument,
      title: 'x'.repeat(DOC_TITLE_LIMIT + 1)
    });
    expect(result.success).toBe(false);
  });

  it('accepts title at exactly the limit', () => {
    const result = HermesDocumentSchema.safeParse({
      ...baseDocument,
      title: 'x'.repeat(DOC_TITLE_LIMIT)
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    expect(
      HermesDocumentSchema.safeParse({ ...baseDocument, title: '' }).success
    ).toBe(false);
  });

  it('rejects empty owner', () => {
    expect(
      HermesDocumentSchema.safeParse({ ...baseDocument, owner: '' }).success
    ).toBe(false);
  });

  it('rejects collaborators exceeding max', () => {
    const tooMany = Array.from({ length: DOC_MAX_COLLABORATORS + 1 }, (_, i) => `c-${i}`);
    const result = HermesDocumentSchema.safeParse({
      ...baseDocument,
      collaborators: tooMany
    });
    expect(result.success).toBe(false);
  });

  it('accepts collaborators at exactly the limit', () => {
    const maxCollabs = Array.from({ length: DOC_MAX_COLLABORATORS }, (_, i) => `c-${i}`);
    const result = HermesDocumentSchema.safeParse({
      ...baseDocument,
      collaborators: maxCollabs
    });
    expect(result.success).toBe(true);
  });

  it('rejects viewers exceeding max', () => {
    const tooMany = Array.from({ length: DOC_MAX_VIEWERS + 1 }, (_, i) => `v-${i}`);
    const result = HermesDocumentSchema.safeParse({
      ...baseDocument,
      viewers: tooMany
    });
    expect(result.success).toBe(false);
  });

  it('accepts viewers at exactly the limit', () => {
    const maxViewers = Array.from({ length: DOC_MAX_VIEWERS }, (_, i) => `v-${i}`);
    const result = HermesDocumentSchema.safeParse({
      ...baseDocument,
      viewers: maxViewers
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid schemaVersion', () => {
    expect(
      HermesDocumentSchema.safeParse({ ...baseDocument, schemaVersion: 'hermes-document-v1' }).success
    ).toBe(false);
  });

  it('rejects negative timestamps', () => {
    expect(
      HermesDocumentSchema.safeParse({ ...baseDocument, createdAt: -1 }).success
    ).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { id: _id, ...noId } = baseDocument;
    expect(HermesDocumentSchema.safeParse(noId).success).toBe(false);

    const { encryptedContent: _ec, ...noContent } = baseDocument;
    expect(HermesDocumentSchema.safeParse(noContent).success).toBe(false);

    const { lastModifiedBy: _lm, ...noModifier } = baseDocument;
    expect(HermesDocumentSchema.safeParse(noModifier).success).toBe(false);
  });
});

describe('DocumentOperationSchema', () => {
  it('accepts a valid operation', () => {
    const parsed = DocumentOperationSchema.parse(baseOperation);
    expect(parsed.docId).toBe('doc-1');
    expect(parsed.vectorClock).toEqual({ 'alice-nullifier': 1 });
  });

  it('accepts operation with via field', () => {
    const parsed = DocumentOperationSchema.parse({ ...baseOperation, via: 'familiar' });
    expect(parsed.via).toBe('familiar');
  });

  it('rejects invalid via value', () => {
    expect(
      DocumentOperationSchema.safeParse({ ...baseOperation, via: 'bot' }).success
    ).toBe(false);
  });

  it('rejects empty docId', () => {
    expect(
      DocumentOperationSchema.safeParse({ ...baseOperation, docId: '' }).success
    ).toBe(false);
  });

  it('rejects empty encryptedDelta', () => {
    expect(
      DocumentOperationSchema.safeParse({ ...baseOperation, encryptedDelta: '' }).success
    ).toBe(false);
  });

  it('rejects negative vector clock values', () => {
    expect(
      DocumentOperationSchema.safeParse({
        ...baseOperation,
        vectorClock: { 'alice-nullifier': -1 }
      }).success
    ).toBe(false);
  });

  it('accepts empty vector clock', () => {
    const parsed = DocumentOperationSchema.parse({ ...baseOperation, vectorClock: {} });
    expect(parsed.vectorClock).toEqual({});
  });

  it('rejects missing required fields', () => {
    const { id: _id, ...noId } = baseOperation;
    expect(DocumentOperationSchema.safeParse(noId).success).toBe(false);

    const { author: _a, ...noAuthor } = baseOperation;
    expect(DocumentOperationSchema.safeParse(noAuthor).success).toBe(false);
  });
});

describe('DocumentKeyShareSchema', () => {
  it('accepts a valid key share', () => {
    const parsed = DocumentKeyShareSchema.parse(baseKeyShare);
    expect(parsed.docId).toBe('doc-1');
    expect(parsed.ownerNullifier).toBe('alice-nullifier');
  });

  it('rejects empty encryptedKey', () => {
    expect(
      DocumentKeyShareSchema.safeParse({ ...baseKeyShare, encryptedKey: '' }).success
    ).toBe(false);
  });

  it('rejects empty collaboratorNullifier', () => {
    expect(
      DocumentKeyShareSchema.safeParse({ ...baseKeyShare, collaboratorNullifier: '' }).success
    ).toBe(false);
  });

  it('rejects missing fields', () => {
    const { docId: _d, ...noDocId } = baseKeyShare;
    expect(DocumentKeyShareSchema.safeParse(noDocId).success).toBe(false);

    const { sharedAt: _s, ...noSharedAt } = baseKeyShare;
    expect(DocumentKeyShareSchema.safeParse(noSharedAt).success).toBe(false);
  });

  it('rejects negative sharedAt', () => {
    expect(
      DocumentKeyShareSchema.safeParse({ ...baseKeyShare, sharedAt: -1 }).success
    ).toBe(false);
  });
});

describe('DocPublishLinkSchema', () => {
  it('accepts a minimal valid publish link', () => {
    const parsed = DocPublishLinkSchema.parse(basePublishLink);
    expect(parsed.articleId).toBe('article-1');
    expect(parsed.synthesisId).toBeUndefined();
  });

  it('accepts publish link with all optional fields', () => {
    const full = {
      ...basePublishLink,
      synthesisId: 'synth-1',
      epoch: 5,
      threadId: 'thread-1'
    };
    const parsed = DocPublishLinkSchema.parse(full);
    expect(parsed.synthesisId).toBe('synth-1');
    expect(parsed.epoch).toBe(5);
    expect(parsed.threadId).toBe('thread-1');
  });

  it('rejects empty articleId', () => {
    expect(
      DocPublishLinkSchema.safeParse({ ...basePublishLink, articleId: '' }).success
    ).toBe(false);
  });

  it('rejects empty topicId', () => {
    expect(
      DocPublishLinkSchema.safeParse({ ...basePublishLink, topicId: '' }).success
    ).toBe(false);
  });

  it('rejects negative publishedAt', () => {
    expect(
      DocPublishLinkSchema.safeParse({ ...basePublishLink, publishedAt: -1 }).success
    ).toBe(false);
  });

  it('rejects negative epoch', () => {
    expect(
      DocPublishLinkSchema.safeParse({ ...basePublishLink, epoch: -1 }).success
    ).toBe(false);
  });
});

describe('constant exports', () => {
  it('exports expected limits', () => {
    expect(DOC_TITLE_LIMIT).toBe(200);
    expect(DOC_MAX_COLLABORATORS).toBe(10);
    expect(DOC_MAX_VIEWERS).toBe(50);
  });
});
