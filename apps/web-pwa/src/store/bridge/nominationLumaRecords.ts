import {
  NOMINATION_AUDIENCE,
  NOMINATION_AUTHOR_SCHEME,
  NOMINATION_PUBLIC_PROTOCOL_VERSION,
  NOMINATION_WRITER_KIND,
  type NominationEventV1,
  type NominationSignedPayload
} from '@vh/data-model';
import {
  createLumaPublicAuthorId,
  createSignedWriteEnvelope
} from '@vh/luma-sdk';
import { signWithStoredDelegationSigningKey } from '@vh/identity-vault';
import { deriveForumAuthorId, type IdentityRecord } from '@vh/types';
import {
  assertLumaForumIdentity,
  deriveForumSignedWriteSessionRef,
  lumaForumDeploymentProfile
} from '../forum/lumaRecords';

export interface NominationRecordInput {
  readonly identity: IdentityRecord | null;
  readonly id: string;
  readonly topicId: string;
  readonly sourceType: 'news' | 'topic' | 'article';
  readonly sourceId: string;
  readonly createdAt: number;
}

export async function createLumaNominationEvent(
  input: NominationRecordInput
): Promise<NominationEventV1> {
  const identity = assertLumaForumIdentity(input.identity);
  const nominatorAuthorId = await deriveForumAuthorId(identity.session.nullifier);
  const payload: NominationSignedPayload = {
    schemaVersion: 'hermes-nomination-v1',
    _protocolVersion: NOMINATION_PUBLIC_PROTOCOL_VERSION,
    _writerKind: NOMINATION_WRITER_KIND,
    _authorScheme: NOMINATION_AUTHOR_SCHEME,
    id: input.id,
    topicId: input.topicId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    nominatorAuthorId,
    createdAt: input.createdAt
  };

  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile: lumaForumDeploymentProfile(),
    audience: NOMINATION_AUDIENCE,
    origin: currentOrigin(),
    scheme: NOMINATION_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(nominatorAuthorId, NOMINATION_AUTHOR_SCHEME),
    sessionRef: await deriveForumSignedWriteSessionRef(identity),
    payload,
    sequence: input.createdAt,
    nonce: randomNonceHex(),
    issuedAt: input.createdAt,
    sign: ({ canonicalBytes }) => signWithStoredDelegationSigningKey(canonicalBytes)
  });

  return {
    ...payload,
    signedWriteEnvelope: {
      ...signedWriteEnvelope,
      audience: NOMINATION_AUDIENCE,
      scheme: NOMINATION_AUTHOR_SCHEME,
      publicAuthor: nominatorAuthorId,
      payload
    }
  };
}

function currentOrigin(): string {
  const origin = (globalThis as typeof globalThis & { location?: { origin?: string } }).location?.origin;
  return typeof origin === 'string' && origin.length > 0 ? origin : 'vh://local';
}

function randomNonceHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
