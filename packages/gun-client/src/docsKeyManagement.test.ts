import { describe, it, expect, vi, afterEach } from 'vitest';
import SEA from 'gun/sea';
import {
  deriveDocumentKey,
  shareDocumentKey,
  receiveDocumentKey,
  encryptDocContent,
  decryptDocContent,
  type SEAPair
} from './docsKeyManagement';

describe('docsKeyManagement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('deriveDocumentKey', () => {
    it('derives a deterministic key from docId and owner pair', async () => {
      const pair = await SEA.pair() as unknown as SEAPair;
      const key1 = await deriveDocumentKey('doc-1', pair);
      const key2 = await deriveDocumentKey('doc-1', pair);
      expect(key1).toBe(key2);
      expect(typeof key1).toBe('string');
      expect(key1.length).toBeGreaterThan(0);
    });

    it('produces different keys for different docIds', async () => {
      const pair = await SEA.pair() as unknown as SEAPair;
      const key1 = await deriveDocumentKey('doc-1', pair);
      const key2 = await deriveDocumentKey('doc-2', pair);
      expect(key1).not.toBe(key2);
    });

    it('throws when SEA.work returns falsy', async () => {
      vi.spyOn(SEA, 'work').mockResolvedValueOnce(undefined as any);
      const pair = await SEA.pair() as unknown as SEAPair;
      await expect(deriveDocumentKey('doc-1', pair)).rejects.toThrow(
        'Failed to derive document key'
      );
    });
  });

  describe('shareDocumentKey + receiveDocumentKey', () => {
    it('round-trips: owner shares, collaborator receives', async () => {
      const ownerPair = await SEA.pair() as unknown as SEAPair;
      const collabPair = await SEA.pair() as unknown as SEAPair;
      const docKey = await deriveDocumentKey('doc-share', ownerPair);

      const encrypted = await shareDocumentKey(docKey, collabPair.epub, ownerPair);
      expect(typeof encrypted).toBe('string');

      const decrypted = await receiveDocumentKey(encrypted, ownerPair.epub, collabPair);
      expect(decrypted).toBe(docKey);
    });

    it('shareDocumentKey throws when shared secret fails', async () => {
      vi.spyOn(SEA, 'secret').mockResolvedValueOnce(undefined as any);
      const pair = await SEA.pair() as unknown as SEAPair;
      await expect(
        shareDocumentKey('key', 'bad-epub', pair)
      ).rejects.toThrow('Failed to derive shared secret for key sharing');
    });

    it('shareDocumentKey throws when encryption fails', async () => {
      const ownerPair = await SEA.pair() as unknown as SEAPair;
      const collabPair = await SEA.pair() as unknown as SEAPair;
      vi.spyOn(SEA, 'encrypt').mockResolvedValueOnce(null as any);
      await expect(
        shareDocumentKey('key', collabPair.epub, ownerPair)
      ).rejects.toThrow('Failed to encrypt document key');
    });

    it('shareDocumentKey JSON-stringifies non-string encrypt result', async () => {
      const ownerPair = await SEA.pair() as unknown as SEAPair;
      const collabPair = await SEA.pair() as unknown as SEAPair;
      const objResult = { ct: 'cipher', iv: 'nonce', s: 'salt' };
      vi.spyOn(SEA, 'encrypt').mockResolvedValueOnce(objResult as any);
      const result = await shareDocumentKey('key', collabPair.epub, ownerPair);
      expect(result).toBe(JSON.stringify(objResult));
    });

    it('receiveDocumentKey JSON-stringifies non-string decrypt result', async () => {
      const ownerPair = await SEA.pair() as unknown as SEAPair;
      const collabPair = await SEA.pair() as unknown as SEAPair;
      const objResult = { nested: 'value' };
      vi.spyOn(SEA, 'decrypt').mockResolvedValueOnce(objResult as any);
      const result = await receiveDocumentKey('enc', ownerPair.epub, collabPair);
      expect(result).toBe(JSON.stringify(objResult));
    });

    it('receiveDocumentKey throws when shared secret fails', async () => {
      vi.spyOn(SEA, 'secret').mockResolvedValueOnce(undefined as any);
      const pair = await SEA.pair() as unknown as SEAPair;
      await expect(
        receiveDocumentKey('enc-key', 'bad-epub', pair)
      ).rejects.toThrow('Failed to derive shared secret for key receiving');
    });

    it('receiveDocumentKey throws when decryption fails', async () => {
      const ownerPair = await SEA.pair() as unknown as SEAPair;
      const collabPair = await SEA.pair() as unknown as SEAPair;
      vi.spyOn(SEA, 'decrypt').mockResolvedValueOnce(undefined as any);
      await expect(
        receiveDocumentKey('bad-data', ownerPair.epub, collabPair)
      ).rejects.toThrow('Failed to decrypt document key');
    });
  });

  describe('encryptDocContent + decryptDocContent', () => {
    it('round-trips Uint8Array content', async () => {
      const ownerPair = await SEA.pair() as unknown as SEAPair;
      const docKey = await deriveDocumentKey('doc-content', ownerPair);

      const original = new Uint8Array([1, 2, 3, 4, 5, 72, 101, 108, 108, 111]);
      const encrypted = await encryptDocContent(original, docKey);
      expect(typeof encrypted).toBe('string');

      const decrypted = await decryptDocContent(encrypted, docKey);
      expect(decrypted).toEqual(original);
    });

    it('handles empty content', async () => {
      const ownerPair = await SEA.pair() as unknown as SEAPair;
      const docKey = await deriveDocumentKey('doc-empty', ownerPair);

      const original = new Uint8Array([]);
      const encrypted = await encryptDocContent(original, docKey);
      const decrypted = await decryptDocContent(encrypted, docKey);
      expect(decrypted).toEqual(original);
    });

    it('encryptDocContent JSON-stringifies non-string encrypt result', async () => {
      const objResult = { ct: 'encrypted-state', iv: 'iv', s: 'salt' };
      vi.spyOn(SEA, 'encrypt').mockResolvedValueOnce(objResult as any);
      const result = await encryptDocContent(new Uint8Array([1, 2, 3]), 'key');
      expect(result).toBe(JSON.stringify(objResult));
    });

    it('encryptDocContent throws when encryption fails', async () => {
      vi.spyOn(SEA, 'encrypt').mockResolvedValueOnce(null as any);
      await expect(
        encryptDocContent(new Uint8Array([1, 2, 3]), 'key')
      ).rejects.toThrow('Failed to encrypt document content');
    });

    it('decryptDocContent throws when decryption fails', async () => {
      vi.spyOn(SEA, 'decrypt').mockResolvedValueOnce(undefined as any);
      await expect(
        decryptDocContent('bad-data', 'key')
      ).rejects.toThrow('Failed to decrypt document content');
    });

    it('decryptDocContent throws when decrypted value is not a string', async () => {
      vi.spyOn(SEA, 'decrypt').mockResolvedValueOnce(12345 as any);
      await expect(
        decryptDocContent('data', 'key')
      ).rejects.toThrow('Failed to decrypt document content');
    });
  });
});
