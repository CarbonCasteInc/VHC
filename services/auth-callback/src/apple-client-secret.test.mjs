import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base64UrlToBytes,
  buildAppleClientSecret,
  pemToPkcs8Bytes,
  utf8ToBase64Url,
} from './apple-client-secret.mjs';

async function generateAppleKeyPem() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(pkcs8).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'));
}

test('builds a verifiable ES256 client secret with Apple claims', async () => {
  const { pem, publicKey } = await generateAppleKeyPem();
  const nowMs = 1_750_000_000_000;
  const jwt = await buildAppleClientSecret({
    teamId: 'TEAM123456',
    clientId: 'com.example.vhc.signin',
    keyId: 'KEYID12345',
    privateKeyPem: pem,
    nowMs,
    ttlSeconds: 600,
  });

  const [headerSeg, payloadSeg, signatureSeg] = jwt.split('.');
  const header = decodeSegment(headerSeg);
  const payload = decodeSegment(payloadSeg);

  assert.equal(header.alg, 'ES256');
  assert.equal(header.kid, 'KEYID12345');
  assert.equal(payload.iss, 'TEAM123456');
  assert.equal(payload.sub, 'com.example.vhc.signin');
  assert.equal(payload.aud, 'https://appleid.apple.com');
  assert.equal(payload.iat, Math.floor(nowMs / 1000));
  assert.equal(payload.exp, Math.floor(nowMs / 1000) + 600);

  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64UrlToBytes(signatureSeg),
    new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
  );
  assert.equal(verified, true);
});

test('clamps oversized TTLs and defaults invalid TTLs', async () => {
  const { pem } = await generateAppleKeyPem();
  const nowMs = 1_750_000_000_000;

  const clamped = await buildAppleClientSecret({
    teamId: 't', clientId: 'c', keyId: 'k', privateKeyPem: pem, nowMs,
    ttlSeconds: 999_999_999,
  });
  const clampedPayload = decodeSegment(clamped.split('.')[1]);
  assert.equal(clampedPayload.exp - clampedPayload.iat, 15_777_000);

  const defaulted = await buildAppleClientSecret({
    teamId: 't', clientId: 'c', keyId: 'k', privateKeyPem: pem, nowMs,
    ttlSeconds: Number.NaN,
  });
  const defaultedPayload = decodeSegment(defaulted.split('.')[1]);
  assert.equal(defaultedPayload.exp - defaultedPayload.iat, 600);
});

test('rejects missing config and malformed key material without leaking it', async () => {
  await assert.rejects(
    buildAppleClientSecret({ teamId: '', clientId: 'c', keyId: 'k', privateKeyPem: 'x' }),
    /apple_client_secret_config_missing/,
  );

  await assert.rejects(
    buildAppleClientSecret({ teamId: 't', clientId: 'c', keyId: 'k', privateKeyPem: '-----BEGIN PRIVATE KEY-----\n@@@not-base64@@@\n-----END PRIVATE KEY-----' }),
    (error) => {
      assert.match(error.message, /apple_private_key_pem_invalid/);
      assert.ok(!error.message.includes('not-base64'));
      return true;
    },
  );

  assert.throws(() => pemToPkcs8Bytes(''), /apple_private_key_pem_invalid/);

  // Structurally valid base64 that is not a PKCS#8 EC key must fail import cleanly.
  await assert.rejects(
    buildAppleClientSecret({
      teamId: 't', clientId: 'c', keyId: 'k',
      privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${Buffer.from('junk-key-bytes').toString('base64')}\n-----END PRIVATE KEY-----`,
    }),
    /apple_private_key_import_failed/,
  );
});

test('base64url helpers round-trip', () => {
  assert.equal(utf8ToBase64Url('{"a":1}'), Buffer.from('{"a":1}').toString('base64url'));
  assert.deepEqual([...base64UrlToBytes('AQID')], [1, 2, 3]);
});
