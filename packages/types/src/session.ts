import { z } from 'zod';

/**
 * Canonical session shape per spec-identity-trust-constituency.md §2/§2.1.
 *
 * All code that stores or checks session data MUST use this type.
 */
export interface SessionResponse {
  token: string;
  trustScore: number;        // [0, 1]
  scaledTrustScore: number;  // Math.round(trustScore * 10000)
  nullifier: string;         // UniquenessNullifier (stable per device)
  createdAt: number;         // epoch ms
  expiresAt: number;         // epoch ms; 0 = no expiry (transitional)
}

export const SessionResponseSchema = z.object({
  token: z.string().min(1),
  trustScore: z.number().min(0).max(1),
  scaledTrustScore: z.number().int().min(0).max(10000),
  nullifier: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(), // 0 = no expiry (transitional)
});
