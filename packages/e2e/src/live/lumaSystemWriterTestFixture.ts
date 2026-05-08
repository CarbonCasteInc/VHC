export const E2E_SYSTEM_WRITER_ID = 'vh-e2e-news-daemon-system-writer-v1';

export const E2E_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL =
  'MCowBQYDK2VwAyEA4ZHLho6yDOsGogTtrVUWiTRIGYlxKexsprzKjbuy9js';

export const E2E_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL =
  'MC4CAQAwBQYDK2VwBCIEIOHbQB3dtUl7cAXBpr6o_V7Tb1YuS6hcp7CLnRS-CscA';

export const E2E_SYSTEM_WRITER_PIN = {
  pinVersion: 1,
  schemaEpoch: 'luma-public-v1',
  maxProtocolVersion: 'luma-public-v1',
  signatureSuite: 'jcs-ed25519-sha256-v1',
  writers: [
    {
      id: E2E_SYSTEM_WRITER_ID,
      status: 'active',
      publicKey: {
        encoding: 'spki-base64url',
        material: E2E_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL,
      },
    },
  ],
};

export const E2E_SYSTEM_WRITER_PIN_JSON = JSON.stringify(E2E_SYSTEM_WRITER_PIN);
