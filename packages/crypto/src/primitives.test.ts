import { describe, expect, it } from 'vitest';
import { aesDecrypt, aesEncrypt, deriveKey, randomBytes, sha256 } from './primitives';

const textDecoder = new TextDecoder();

describe('crypto primitives', () => {
  it('creates deterministic SHA-256 digests', async () => {
    const digest = await sha256('hello world');
    expect(digest).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('hashes ArrayBuffer and ArrayBufferView', async () => {
    const buf = new TextEncoder().encode('buffer').buffer;
    const view = new Uint8Array(buf);
    const digestBuf = await sha256(buf);
    const digestView = await sha256(view);
    expect(digestBuf).toBe(digestView);
  });

  it('rejects unsupported hash input', async () => {
    await expect(sha256(123 as any)).rejects.toThrow(TypeError);
  });

  it('returns secure random bytes of the requested length', async () => {
    const size = 32;
    const bytes = await randomBytes(size);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(size);
    const uniqueValues = new Set(bytes);
    expect(uniqueValues.size).toBeGreaterThan(1);
  });

  it('rejects invalid random byte length', async () => {
    await expect(randomBytes(0)).rejects.toThrow();
  });

  it('derives deterministic PBKDF2 keys', async () => {
    const first = await deriveKey('secret', 'salt');
    const second = await deriveKey('secret', 'salt');
    expect(first).toHaveLength(32);
    expect(Buffer.from(first).toString('hex')).toBe(
      Buffer.from(second).toString('hex')
    );
  });

  it('encrypts and decrypts using AES-GCM', async () => {
    const key = await deriveKey('vh-dev-secret', 'vh-dev-salt');
    const message = 'local-first forever';
    const { iv, ciphertext } = await aesEncrypt(message, key);
    expect(ciphertext.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(ciphertext).toString('hex')).not.toContain(message);
    const decrypted = await aesDecrypt(iv, ciphertext, key);
    expect(textDecoder.decode(decrypted)).toBe(message);
  });

  it('encrypts Uint8Array payloads', async () => {
    const key = await deriveKey('vh-dev-secret', 'vh-dev-salt');
    const data = new TextEncoder().encode('bytes');
    const { iv, ciphertext } = await aesEncrypt(data, key);
    const decrypted = await aesDecrypt(iv, ciphertext, key);
    expect(decrypted).toBeInstanceOf(Uint8Array);
  });

  it('throws on invalid AES key length', async () => {
    const badKey = new Uint8Array(10);
    await expect(aesEncrypt('hi', badKey)).rejects.toThrow(/AES key/);
  });
});
