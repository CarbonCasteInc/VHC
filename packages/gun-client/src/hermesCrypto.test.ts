import { describe, expect, it } from 'vitest';
import SEA from 'gun/sea';
import { decryptMessagePayload, deriveSharedSecret, encryptMessagePayload } from './hermesCrypto';

describe('hermesCrypto helpers', () => {
  it('encrypts and decrypts a payload round-trip', async () => {
    const sender = await SEA.pair();
    const recipient = await SEA.pair();
    const secret = await deriveSharedSecret(recipient.epub as string, sender as any);
    const ciphertext = await encryptMessagePayload({ text: 'hello world' }, secret);
    const plaintext = await decryptMessagePayload(ciphertext, secret);
    expect(plaintext.text).toBe('hello world');
  });

  it('throws on invalid ciphertext', async () => {
    const sender = await SEA.pair();
    const recipient = await SEA.pair();
    const secret = await deriveSharedSecret(recipient.epub as string, sender as any);
    await expect(decryptMessagePayload('not-a-ciphertext', secret)).rejects.toThrow();
  });
});
