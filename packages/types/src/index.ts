import { z } from 'zod';

export type { AttestationPayload } from './attestation';

export interface VerificationResult {
  success: boolean;
  trustScore: number;
  issuedAt: number;
}

export interface SessionResponse {
  token: string;
  trustScore: number;
  nullifier: string;
}

export interface RegionProof {
  proof: string;
  publicSignals: string[];
  timestamp: number;
}

export const AttestationPayloadSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  integrityToken: z.string().min(1),
  deviceKey: z.string().min(1),
  nonce: z.string().min(1)
});

export const VerificationResultSchema = z.object({
  success: z.boolean(),
  trustScore: z.number().min(0).max(1),
  issuedAt: z.number().int().nonnegative()
});

export const SessionResponseSchema = z.object({
  token: z.string().min(1),
  trustScore: z.number().min(0).max(1),
  nullifier: z.string().min(1)
});

export const RegionProofSchema = z.object({
  proof: z.string().min(1),
  publicSignals: z.array(z.string().min(1)).min(1),
  timestamp: z.number().int().nonnegative()
});

export type UniquenessNullifier = string;
export type TrustScore = number; // 0 to 1
export type ScaledTrustScore = number; // 0 to 10000

export interface SentimentSignal {
  topic_id: string;
  analysis_id: string;
  point_id: string;
  agreement: 1 | 0 | -1;
  weight: number;
  constituency_proof: ConstituencyProof;
  emitted_at: number;
}

export type RegionProofTuple = [string, string, string]; // [district_hash, nullifier, merkle_root]

export interface ConstituencyProof {
  district_hash: string;
  nullifier: string;
  merkle_root: string;
}

export const ConstituencyProofSchema = z.object({
  district_hash: z.string().min(1),
  nullifier: z.string().min(1),
  merkle_root: z.string().min(1)
});

export const SentimentSignalSchema = z.object({
  topic_id: z.string().min(1),
  analysis_id: z.string().min(1),
  point_id: z.string().min(1),
  agreement: z.union([z.literal(1), z.literal(0), z.literal(-1)]),
  weight: z.number().min(0).max(2),
  constituency_proof: ConstituencyProofSchema,
  emitted_at: z.number().int().nonnegative()
});

export type { IdentityRecord, DevicePair } from './identity';

export type {
  FamiliarRecord,
  DelegationGrant,
  OnBehalfOfAssertion,
  DelegationTier,
  DelegationScope
} from './delegation';

export {
  FamiliarRecordSchema,
  DelegationGrantSchema,
  OnBehalfOfAssertionSchema,
  DelegationTierSchema,
  DelegationScopeSchema,
  TIER_SCOPES
} from './delegation';

export type HermesMessageType = 'text' | 'image' | 'file';
export type HermesChannelType = 'dm';
export type HermesAttachmentType = 'image' | 'file';

export interface HermesPayload {
  text?: string;
  attachmentUrl?: string;
  attachmentType?: HermesAttachmentType;
}

export interface HermesMessage {
  id: string;
  schemaVersion: 'hermes-message-v0';
  channelId: string;
  sender: string;
  recipient: string;
  timestamp: number;
  content: string;
  type: HermesMessageType;
  senderDevicePub: string;
  signature: string;
  deviceId?: string;
}

export interface DirectoryEntry {
  schemaVersion: 'hermes-directory-v0';
  nullifier: string;
  devicePub: string;
  epub: string;
  displayName?: string;
  registeredAt: number;
  lastSeenAt: number;
}

export interface HermesChannel {
  id: string;
  schemaVersion: 'hermes-channel-v0';
  participants: string[];
  participantEpubs?: Record<string, string>;
  participantDevicePubs?: Record<string, string>;
  lastMessageAt: number;
  type: HermesChannelType;
}

export interface HermesThread {
  id: string;
  schemaVersion: 'hermes-thread-v0';
  title: string;
  content: string;
  author: string;
  timestamp: number;
  tags: string[];
  sourceAnalysisId?: string;
  upvotes: number;
  downvotes: number;
  score: number;
}

interface BaseHermesCommentCommon {
  id: string;
  threadId: string;
  parentId: string | null;
  content: string;
  author: string;
  timestamp: number;
  upvotes: number;
  downvotes: number;
}

export type HermesCommentV0 = BaseHermesCommentCommon & {
  schemaVersion: 'hermes-comment-v0';
  type: 'reply' | 'counterpoint';
  targetId?: string;
};

export type HermesCommentV1 = BaseHermesCommentCommon & {
  schemaVersion: 'hermes-comment-v1';
  stance: 'concur' | 'counter' | 'discuss';
  type?: 'reply' | 'counterpoint';
  targetId?: string;
};

export type HermesCommentHydratable = HermesCommentV0 | HermesCommentV1;
export type HermesComment = HermesCommentV1;

export type HermesModerationAction = 'hide' | 'remove';

export interface HermesModerationEvent {
  id: string;
  targetId: string;
  action: HermesModerationAction;
  moderator: string;
  reason: string;
  timestamp: number;
  signature: string;
}

export { z };

export function decodeRegionProof(tuple: RegionProofTuple): ConstituencyProof {
  const [district_hash, nullifier, merkle_root] = tuple;
  return { district_hash, nullifier, merkle_root };
}

// Participation governor types & schemas
export {
  type BudgetActionKey,
  type BudgetLimit,
  type DailyUsage,
  type NullifierBudget,
  BudgetActionKeySchema,
  BudgetLimitSchema,
  DailyUsageSchema,
  NullifierBudgetSchema,
  BUDGET_ACTION_KEYS,
  SEASON_0_BUDGET_DEFAULTS,
} from './budget';

// Participation governor runtime utilities
export {
  type BudgetCheckResult,
  initializeNullifierBudget,
  rolloverBudgetIfNeeded,
  canConsumeBudget,
  consumeBudget,
} from './budget-utils';
