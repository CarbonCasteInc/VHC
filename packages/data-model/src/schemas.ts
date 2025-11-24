import { z } from 'zod';

export const ProfileSchema = z.object({
  pubkey: z.string().min(1),
  username: z.string().min(3).max(30),
  bio: z.string().max(140).optional(),
  avatarCid: z.string().optional()
});

export const MessageSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  sender: z.string().min(1),
  content: z.string().min(1),
  kind: z.enum(['text', 'image', 'system'])
});

export const AnalysisSchema = z.object({
  canonicalId: z.string().min(1),
  summary: z.string().min(1),
  biases: z.array(z.string().min(1)),
  counterpoints: z.array(z.string().min(1)),
  sentimentScore: z.number().min(-1).max(1),
  timestamp: z.number().int().nonnegative()
});

export const SignalSchema = z.object({
  topic_id: z.string().min(1),
  analysis_id: z.string().min(1),
  bias_vector: z.record(z.union([z.literal(1), z.literal(-1), z.literal(0)])),
  weight: z.number(),
  engagementScore: z.number().nonnegative()
});

export const CanonicalAnalysisSchema = z.object({
  url: z.string().url(),
  urlHash: z.string().min(1),
  summary: z.string().min(1),
  biases: z.array(z.string().min(1)),
  counterpoints: z.array(z.string().min(1)),
  perspectives: z.array(
    z.object({
      id: z.string(),
      frame: z.string(),
      reframe: z.string()
    })
  ).optional(), // Optional for backward compatibility with existing data
  sentimentScore: z.number().min(-1).max(1),
  timestamp: z.number().int().nonnegative()
});

export const CivicDecaySchema = z.object({
  topicId: z.string().min(1),
  interactions: z.number().int().nonnegative(),
  weight: z.number().nonnegative(),
  lastUpdated: z.number().int().nonnegative()
});

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  author: z.string().min(1), // Pubkey
  title: z.string().min(10),
  summary: z.string().max(500),
  fundingRequest: z.string().regex(/^\d+$/), // BigInt as string for RVU
  recipient: z.string().min(1), // Address
  attestationProof: z.string().min(1), // ZK or signature
  timestamp: z.number().int().nonnegative()
});

export const VoteSchema = z.object({
  proposalId: z.string().uuid(),
  amount: z.string().regex(/^\d+$/), // RVU staked
  direction: z.enum(['for', 'against']),
  voter: z.string().min(1) // Pubkey
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type GovernanceVote = z.infer<typeof VoteSchema>;
