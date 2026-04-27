import { z } from 'zod';

const NonEmptyString = z.string().trim().min(1);
const PositiveTimestamp = z.number().int().nonnegative();

export const TrustedOperatorCapabilitySchema = z.enum([
  'review_news_report',
  'write_synthesis_correction',
  'moderate_story_thread',
  'private_support_handoff',
]);

export const TrustedOperatorAuthorizationSchema = z
  .object({
    schemaVersion: z.literal('vh-trusted-operator-authorization-v1'),
    operator_id: NonEmptyString,
    role: z.literal('trusted_beta_operator'),
    capabilities: z.array(TrustedOperatorCapabilitySchema).min(1),
    granted_at: PositiveTimestamp.optional(),
    expires_at: PositiveTimestamp.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expires_at !== undefined && value.granted_at !== undefined && value.expires_at <= value.granted_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expires_at'],
        message: 'expires_at must be after granted_at',
      });
    }
  });

export type TrustedOperatorCapability = z.infer<typeof TrustedOperatorCapabilitySchema>;
export type TrustedOperatorAuthorization = z.infer<typeof TrustedOperatorAuthorizationSchema>;

export const TRUSTED_BETA_OPERATOR_CAPABILITIES: readonly TrustedOperatorCapability[] = [
  'review_news_report',
  'write_synthesis_correction',
  'moderate_story_thread',
  'private_support_handoff',
] as const;

export function assertTrustedOperatorAuthorization(
  authorization: unknown,
  expectedOperatorId: string,
  capability: TrustedOperatorCapability,
  now: number = Date.now(),
): TrustedOperatorAuthorization {
  const parsed = TrustedOperatorAuthorizationSchema.safeParse(authorization);
  if (!parsed.success) {
    throw new Error('Trusted operator authorization is required');
  }
  const normalizedExpected = expectedOperatorId.trim();
  if (!normalizedExpected) {
    throw new Error('operatorId is required');
  }
  if (parsed.data.operator_id !== normalizedExpected) {
    throw new Error('Trusted operator authorization does not match operator audit id');
  }
  if (!parsed.data.capabilities.includes(capability)) {
    throw new Error(`Trusted operator authorization lacks ${capability}`);
  }
  if (parsed.data.expires_at !== undefined && parsed.data.expires_at <= now) {
    throw new Error('Trusted operator authorization has expired');
  }
  return parsed.data;
}
