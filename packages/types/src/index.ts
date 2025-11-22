import { z } from 'zod';

export interface AttestationPayload {
  platform: 'ios' | 'android' | 'web';
  integrityToken: string;
  deviceKey: string;
  nonce: string;
}

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

export type UniquenessNullifier = string;

export interface SentimentSignal {
  actorId: string;
  targetId: string;
  magnitude: number;
  confidence: number;
  createdAt: number;
}

export { z };
