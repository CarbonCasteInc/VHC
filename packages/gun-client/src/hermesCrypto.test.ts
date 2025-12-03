import { describe, expect, it, vi, afterEach } from 'vitest';
import SEA from 'gun/sea';
import { decryptMessagePayload, deriveSharedSecret, encryptMessagePayload } from './hermesCrypto';

describe('hermesCrypto helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('throws when shared secret cannot be derived', async () => {
    vi.spyOn(SEA, 'secret').mockResolvedValueOnce(undefined as any);
    await expect(deriveSharedSecret('recipient', { epub: 'a', epriv: 'b' } as any)).rejects.toThrow(
      'Failed to derive shared secret'
    );
  });

  it('throws when encryption fails', async () => {
    vi.spyOn(SEA, 'encrypt').mockResolvedValueOnce(null as any);
    await expect(encryptMessagePayload({ text: 'hi' }, 'secret')).rejects.toThrow('Encryption failed');
  });

  it('throws when decrypted payload is not valid JSON', async () => {
    vi.spyOn(SEA, 'decrypt').mockResolvedValueOnce('not-json');
    await expect(decryptMessagePayload('cipher', 'secret')).rejects.toThrow('Failed to parse decrypted payload');
  });
});
