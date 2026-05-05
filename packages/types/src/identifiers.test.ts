import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  deriveForumAuthorId,
  deriveIdentityDirectoryKey,
  deriveVoterId,
  LUMA_IDENTIFIER_INFO,
  type VoterIdScope
} from './identifiers';

const PRINCIPAL_NULLIFIER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ZERO_HKDF_SHA256_SALT = Buffer.alloc(32, 0);
const LOWER_64_CHAR_HEX = /^[0-9a-f]{64}$/;

function nodeHkdfHex(principalNullifier: string, salt: Buffer, info: string): string {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(principalNullifier, 'utf8'),
      salt,
      Buffer.from(info, 'utf8'),
      32
    )
  ).toString('hex');
}

describe('LUMA public id derivation', () => {
  it('matches frozen Node hkdfSync vectors through the WebCrypto implementation', async () => {
    const vectors = [
      {
        label: 'forumAuthorId',
        expected: '7cf7ce7f3c163105e9b9a40a95d4cfb36fdcd8e8835df9012398fd3aed838639',
        actual: await deriveForumAuthorId(PRINCIPAL_NULLIFIER),
        node: nodeHkdfHex(
          PRINCIPAL_NULLIFIER,
          ZERO_HKDF_SHA256_SALT,
          LUMA_IDENTIFIER_INFO['forum-author-v1']
        )
      },
      {
        label: 'identityDirectoryKey',
        expected: 'a11763992fbdbffb23a5275426fcc648918eeafff98090155fad1b43beade0f6',
        actual: await deriveIdentityDirectoryKey(PRINCIPAL_NULLIFIER),
        node: nodeHkdfHex(
          PRINCIPAL_NULLIFIER,
          ZERO_HKDF_SHA256_SALT,
          LUMA_IDENTIFIER_INFO['identity-directory-v1']
        )
      },
      {
        label: 'voterId',
        expected: '3da82b3ff8a431e591492e313ff4f34d28c142227ad8c6c7e7132fe420a19c2d',
        actual: await deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-alpha', epoch: 7 }),
        node: nodeHkdfHex(
          PRINCIPAL_NULLIFIER,
          Buffer.from('topic-alpha:7', 'utf8'),
          LUMA_IDENTIFIER_INFO['voter-v1']
        )
      }
    ];

    for (const vector of vectors) {
      expect(vector.actual, vector.label).toBe(vector.expected);
      expect(vector.node, vector.label).toBe(vector.expected);
    }
  });

  it('returns lowercase 64-char hex ids that do not expose the raw principalNullifier', async () => {
    const ids = [
      await deriveForumAuthorId(PRINCIPAL_NULLIFIER),
      await deriveIdentityDirectoryKey(PRINCIPAL_NULLIFIER),
      await deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-alpha', epoch: 7 })
    ];

    for (const id of ids) {
      expect(id).toMatch(LOWER_64_CHAR_HEX);
      expect(id).not.toBe(PRINCIPAL_NULLIFIER);
    }
  });

  it('does not collide across the initial linkability domains for the same principal', async () => {
    const ids = new Set([
      await deriveForumAuthorId(PRINCIPAL_NULLIFIER),
      await deriveIdentityDirectoryKey(PRINCIPAL_NULLIFIER),
      await deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-alpha', epoch: 7 })
    ]);

    expect(ids.size).toBe(3);
  });

  it('scopes voterId by topic and epoch', async () => {
    await expect(deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-alpha', epoch: 7 }))
      .resolves.toBe('3da82b3ff8a431e591492e313ff4f34d28c142227ad8c6c7e7132fe420a19c2d');
    await expect(deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-alpha', epoch: 8 }))
      .resolves.toBe('f8e51c913cf5a5705873dd7ef7b12cc3d03a6b06ff315c6f128a7fb727e69960');
    await expect(deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-beta', epoch: 7 }))
      .resolves.toBe('83210d493c373ce63d11498a2b648961cde5318b418bb8ce91f0cc78f615c1ec');
  });

  it('rejects ambiguous voterId scopes', async () => {
    await expect(deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: '', epoch: 7 }))
      .rejects.toThrow('topicId is required');
    await expect(deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: '   ', epoch: 7 }))
      .rejects.toThrow('topicId is required');
    await expect(deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-alpha', epoch: -1 }))
      .rejects.toThrow('epoch must be a nonnegative integer');
    await expect(deriveVoterId(PRINCIPAL_NULLIFIER, { topicId: 'topic-alpha', epoch: 7.5 }))
      .rejects.toThrow('epoch must be a nonnegative integer');
    await expect(deriveVoterId(
      PRINCIPAL_NULLIFIER,
      { topicId: 'topic-alpha', epoch: '7' } as unknown as VoterIdScope
    )).rejects.toThrow('epoch must be a nonnegative integer');
  });
});
