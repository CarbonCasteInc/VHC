import type { IdentityRecord } from '@vh/types';
import {
  digestAssuranceEnvelope,
  digestSignedWritePayload,
  validateBetaLocalAssuranceEnvelope,
  verifySignedWriteEnvelope,
  type AudienceTag,
  type DeploymentProfile,
  type LinkabilityDomainName,
  type SignedWriteEnvelope,
  type SignedWriteSessionRef,
} from '@vh/luma-sdk';
import {
  getDelegationSigningPublicKey,
  verifyWithDelegationSigningPublicKey,
} from '@vh/identity-vault';

export const MVP_WRITE_ACTIONS = Object.freeze([
  'vh-directory-entry',
  'vh-forum-thread',
  'vh-forum-comment',
  'vh-forum-post',
  'vh-forum-nomination',
  'vh-news-report',
  'vh-aggregate-voter',
  'vh-stance-vote',
  'vh-stance-clear',
] as const satisfies readonly AudienceTag[]);

export type MvpWriteAction = typeof MVP_WRITE_ACTIONS[number];

export interface MvpActionPolicyInput<TPayload = unknown> {
  identity: IdentityRecord | null;
  profile: DeploymentProfile;
  action: MvpWriteAction;
  envelope: SignedWriteEnvelope<TPayload>;
  scheme: LinkabilityDomainName;
  publicAuthor: string;
  origin: string;
  now?: number;
}

export interface MvpActionPolicyResult {
  allowed: true;
  sessionRef: SignedWriteSessionRef;
  assuranceEnvelopeDigest: string;
  limitations: readonly string[];
}

interface IdentitySignedWriteSessionRefOptions {
  /**
   * Dev/e2e compatibility for older tests and local fixtures that predate the
   * beta-local AssuranceEnvelope runtime path. Public-beta callers must keep
   * this false so action writes are AssuranceEnvelope-backed.
   */
  allowLegacySessionDigest?: boolean;
}

export function assertMvpActionIdentityReady(input: {
  identity: IdentityRecord | null;
  profile: DeploymentProfile;
  action: MvpWriteAction;
  now?: number;
}): { limitations: readonly string[] } {
  if (!MVP_WRITE_ACTIONS.includes(input.action)) {
    throw new Error(`Unsupported MVP LUMA action: ${input.action}`);
  }
  const identity = input.identity;
  if (!identity?.session) {
    throw new Error('MVP LUMA action requires an active identity');
  }
  if (input.profile !== 'public-beta') {
    throw new Error(`MVP LUMA action requires public-beta profile, got ${input.profile}`);
  }

  const now = input.now ?? Date.now();
  const assuranceEnvelope = identity.assuranceEnvelope;
  if (!assuranceEnvelope) {
    throw new Error('MVP LUMA action requires valid beta-local AssuranceEnvelope: missing AssuranceEnvelope');
  }
  const assuranceValidation = validateBetaLocalAssuranceEnvelope(assuranceEnvelope, now);
  if (!assuranceValidation.valid) {
    throw new Error(`MVP LUMA action requires valid beta-local AssuranceEnvelope: ${assuranceValidation.failures.join('; ')}`);
  }
  if (!identity.session.expiresAt || now >= identity.session.expiresAt) {
    throw new Error('MVP LUMA action requires a non-expired active session');
  }
  return { limitations: assuranceEnvelope.limitations };
}

export async function deriveIdentitySignedWriteSessionRef(
  identity: IdentityRecord,
  options: IdentitySignedWriteSessionRefOptions = {}
): Promise<SignedWriteSessionRef> {
  if (!identity.session?.token) {
    throw new Error('MVP LUMA action policy requires an active session token');
  }
  if (!identity.assuranceEnvelope) {
    if (options.allowLegacySessionDigest) {
      return {
        tokenHash: await digestSignedWritePayload({ token: identity.session.token }),
        envelopeDigest: await digestSignedWritePayload({
          kind: 'legacy-luma-session-ref-v0',
          nullifier: identity.session.nullifier,
          scaledTrustScore: identity.session.scaledTrustScore,
          createdAt: identity.session.createdAt,
          expiresAt: identity.session.expiresAt,
        }),
      };
    }
    throw new Error('MVP LUMA action policy requires an AssuranceEnvelope');
  }
  return {
    tokenHash: await digestSignedWritePayload({ token: identity.session.token }),
    envelopeDigest: await digestAssuranceEnvelope(identity.assuranceEnvelope),
  };
}

export async function assertCanPerformMvpAction<TPayload>(
  input: MvpActionPolicyInput<TPayload>
): Promise<MvpActionPolicyResult> {
  const now = input.now ?? Date.now();
  const ready = assertMvpActionIdentityReady(input);
  const identity = input.identity as IdentityRecord;

  const sessionRef = await deriveIdentitySignedWriteSessionRef(identity);
  const publicKey = await getDelegationSigningPublicKey();
  const verification = await verifySignedWriteEnvelope({
    envelope: input.envelope,
    verify: ({ canonicalBytes, signature }) =>
      verifyWithDelegationSigningPublicKey({
        message: canonicalBytes,
        signature,
        key: publicKey,
      }),
    expected: {
      profile: 'public-beta',
      audience: input.action,
      scheme: input.scheme,
      origin: input.origin,
      publicAuthor: input.publicAuthor,
      sessionRef,
      lifecycle: {
        enabled: true,
        expiresAt: identity.session.expiresAt,
        now,
      },
    },
  });
  if (!verification.valid) {
    throw new Error(`MVP LUMA action signed-write validation failed: ${verification.reason}`);
  }

  return {
    allowed: true,
    sessionRef,
    assuranceEnvelopeDigest: sessionRef.envelopeDigest,
    limitations: ready.limitations,
  };
}
