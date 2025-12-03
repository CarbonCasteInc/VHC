import SEA from 'gun/sea';
import type { HermesPayload } from '@vh/types';

export async function deriveSharedSecret(
  recipientDevicePub: string,
  senderPair: { epub: string; epriv: string }
): Promise<string> {
  const secret = await SEA.secret(recipientDevicePub, senderPair);
  if (!secret) {
    throw new Error('Failed to derive shared secret');
  }
  return secret;
}

export async function encryptMessagePayload(plaintext: HermesPayload, secret: string): Promise<string> {
  const payload = JSON.stringify(plaintext ?? {});
  const encrypted = await SEA.encrypt(payload, secret);
  if (encrypted === null || encrypted === undefined) {
    throw new Error('Encryption failed');
  }
  return typeof encrypted === 'string' ? encrypted : JSON.stringify(encrypted);
}

export async function decryptMessagePayload(ciphertext: string, secret: string): Promise<HermesPayload> {
  const decrypted = await SEA.decrypt(ciphertext, secret);
  if (!decrypted) {
    throw new Error('Decryption failed');
  }
  try {
    const payloadString = typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted);
    return JSON.parse(payloadString) as HermesPayload;
  } catch (error) {
    throw new Error('Failed to parse decrypted payload');
  }
}
