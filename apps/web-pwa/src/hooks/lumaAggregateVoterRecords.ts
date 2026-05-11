import {
  AGGREGATE_PUBLIC_PROTOCOL_VERSION,
  AGGREGATE_VOTER_AUDIENCE,
  AGGREGATE_VOTER_AUTHOR_SCHEME,
  AGGREGATE_VOTER_NODE_VERSION,
  AGGREGATE_VOTER_WRITER_KIND,
  type AggregateVoterNodeV1,
  type AggregateVoterSignedPayload
} from '@vh/data-model';
import {
  createLumaPublicAuthorId,
  createSignedWriteEnvelope,
  digestSignedWritePayload,
  type DeploymentProfile,
  type SignedWriteSessionRef
} from '@vh/luma-sdk';
import { signWithStoredDelegationSigningKey } from '@vh/identity-vault';
import { deriveVoterId, type IdentityRecord } from '@vh/types';
import {
  assertCanPerformMvpAction,
  deriveIdentitySignedWriteSessionRef
} from '../luma/mvpActionPolicy';

interface AggregateVoterNodeInput {
  readonly identity?: IdentityRecord | null;
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly pointId: string;
  readonly agreement: -1 | 0 | 1;
  readonly weight: number;
  readonly updatedAt: string;
  readonly sequence: number;
}

export interface LumaAggregateVoterNodeFromPrincipalInput extends AggregateVoterNodeInput {
  readonly principalNullifier: string;
}

export interface LumaAggregateVoterNodeFromVoterInput extends AggregateVoterNodeInput {
  readonly voterId: string;
}

export interface LumaAggregateVoterNodeResult {
  readonly voterId: string;
  readonly node: AggregateVoterNodeV1;
}

type LumaAggregateVoterEnv = Record<string, string | boolean | undefined>;

export function lumaAggregateVoterDeploymentProfile(): DeploymentProfile {
  if (isE2EMode()) return 'e2e';
  const viteEnv = readLumaAggregateVoterEnv();
  const configured = viteEnv?.VITE_LUMA_PROFILE;
  if (
    configured === 'dev'
    || configured === 'public-beta'
    || configured === 'production-attestation'
  ) {
    return configured;
  }
  if (viteEnv?.DEV === true || viteEnv?.MODE === 'development') return 'dev';
  return 'public-beta';
}

export async function createLumaAggregateVoterNodeFromPrincipal(
  input: LumaAggregateVoterNodeFromPrincipalInput
): Promise<LumaAggregateVoterNodeResult> {
  const voterId = await deriveVoterId(input.principalNullifier, {
    topicId: input.topicId,
    epoch: input.epoch
  });
  return {
    voterId,
    node: await createLumaAggregateVoterNodeFromVoterId({
      ...input,
      voterId
    })
  };
}

export async function createLumaAggregateVoterNodeFromVoterId(
  input: LumaAggregateVoterNodeFromVoterInput
): Promise<AggregateVoterNodeV1> {
  const profile = lumaAggregateVoterDeploymentProfile();
  const origin = currentOrigin();
  const payload: AggregateVoterSignedPayload = {
    schema_version: AGGREGATE_VOTER_NODE_VERSION,
    _protocolVersion: AGGREGATE_PUBLIC_PROTOCOL_VERSION,
    _writerKind: AGGREGATE_VOTER_WRITER_KIND,
    _authorScheme: AGGREGATE_VOTER_AUTHOR_SCHEME,
    topic_id: input.topicId,
    synthesis_id: input.synthesisId,
    epoch: input.epoch,
    voter_id: input.voterId,
    point_id: input.pointId,
    agreement: input.agreement,
    weight: input.weight,
    updated_at: input.updatedAt
  };
  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile,
    audience: AGGREGATE_VOTER_AUDIENCE,
    origin,
    scheme: AGGREGATE_VOTER_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(input.voterId, AGGREGATE_VOTER_AUTHOR_SCHEME),
    sessionRef: input.identity
      ? await deriveIdentitySignedWriteSessionRef(input.identity, {
        allowLegacySessionDigest: profile !== 'public-beta'
      })
      : await deriveAggregateVoterSignedWriteSessionRef(input),
    payload,
    sequence: input.sequence,
    nonce: randomNonceHex(),
    issuedAt: input.sequence,
    sign: ({ canonicalBytes }) => signWithStoredDelegationSigningKey(canonicalBytes)
  });
  if (profile === 'public-beta') {
    await assertCanPerformMvpAction({
      identity: input.identity ?? null,
      profile,
      action: AGGREGATE_VOTER_AUDIENCE,
      envelope: signedWriteEnvelope,
      scheme: AGGREGATE_VOTER_AUTHOR_SCHEME,
      publicAuthor: input.voterId,
      origin
    });
  }

  return {
    ...payload,
    signedWriteEnvelope: {
      ...signedWriteEnvelope,
      audience: AGGREGATE_VOTER_AUDIENCE,
      scheme: AGGREGATE_VOTER_AUTHOR_SCHEME,
      publicAuthor: input.voterId,
      payload
    }
  };
}

export async function deriveAggregateVoterSignedWriteSessionRef(
  input: Pick<LumaAggregateVoterNodeFromVoterInput, 'topicId' | 'synthesisId' | 'epoch' | 'voterId'>
): Promise<SignedWriteSessionRef> {
  return {
    tokenHash: await digestSignedWritePayload({
      kind: 'vh-aggregate-voter-author-ref-v1',
      voterId: input.voterId
    }),
    envelopeDigest: await digestSignedWritePayload({
      kind: 'vh-aggregate-voter-context-ref-v1',
      topicId: input.topicId,
      synthesisId: input.synthesisId,
      epoch: input.epoch,
      voterId: input.voterId
    })
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

function isE2EMode(): boolean {
  const override = (globalThis as typeof globalThis & { __VH_E2E_OVERRIDE__?: unknown }).__VH_E2E_OVERRIDE__;
  if (override === true) return true;

  const viteEnv = readLumaAggregateVoterEnv();
  return viteEnv?.VITE_E2E === '1'
    || viteEnv?.VITE_PLAYWRIGHT === '1'
    || viteEnv?.MODE === 'test'
    || viteEnv?.VITEST === 'true';
}

function readLumaAggregateVoterEnv(): LumaAggregateVoterEnv {
  const override = (globalThis as typeof globalThis & {
    __VH_IMPORT_META_ENV__?: LumaAggregateVoterEnv;
  }).__VH_IMPORT_META_ENV__;
  return override ?? (import.meta as unknown as { env: LumaAggregateVoterEnv }).env;
}
