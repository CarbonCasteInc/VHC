/**
 * Apple client-secret builder (Slice C0).
 *
 * Apple's OAuth token endpoint does not accept a static client secret.
 * The client secret is a short-lived ES256-signed JWT built server-side
 * from the Apple developer key material:
 *
 *   - VH_AUTH_APPLE_TEAM_ID     -> `iss`
 *   - VH_AUTH_APPLE_CLIENT_ID   -> `sub` (the Services ID)
 *   - VH_AUTH_APPLE_KEY_ID      -> JWT header `kid`
 *   - VH_AUTH_APPLE_PRIVATE_KEY -> PKCS#8 PEM (the .p8 download)
 *
 * SECURITY: the private key and the signed secret never leave this
 * boundary. They must not appear in responses, logs, or error messages.
 */

const encoder = new TextEncoder();

const APPLE_AUDIENCE = 'https://appleid.apple.com';
const DEFAULT_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 15777000; // Apple caps client-secret JWTs at 6 months.

function subtleCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  throw new Error('WebCrypto subtle API is required');
}

export function bytesToBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value) {
  const normalized = String(value ?? '').replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function utf8ToBase64Url(text) {
  return bytesToBase64Url(encoder.encode(text));
}

export function pemToPkcs8Bytes(pem) {
  const body = String(pem ?? '')
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('apple_private_key_pem_invalid');
  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error('apple_private_key_pem_invalid');
  }
}

export async function importAppleSigningKey(privateKeyPem) {
  const pkcs8 = pemToPkcs8Bytes(privateKeyPem);
  try {
    return await subtleCrypto().subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new Error('apple_private_key_import_failed');
  }
}

/**
 * Build the ES256-signed Apple client secret JWT.
 * Returns the compact JWT string. Never log or echo the result.
 */
export async function buildAppleClientSecret({
  teamId,
  clientId,
  keyId,
  privateKeyPem,
  nowMs = Date.now(),
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  if (!teamId || !clientId || !keyId || !privateKeyPem) {
    throw new Error('apple_client_secret_config_missing');
  }
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? Math.min(Math.floor(ttlSeconds), MAX_TTL_SECONDS)
    : DEFAULT_TTL_SECONDS;

  const issuedAt = Math.floor(nowMs / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: teamId,
    iat: issuedAt,
    exp: issuedAt + ttl,
    aud: APPLE_AUDIENCE,
    sub: clientId,
  };

  const signingInput = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(payload))}`;
  const key = await importAppleSigningKey(privateKeyPem);
  const signature = await subtleCrypto().subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}
