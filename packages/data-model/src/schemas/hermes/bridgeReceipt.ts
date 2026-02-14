import { z } from 'zod';
import { DeliveryIntentSchema } from './bridgeAction';

/**
 * Delivery receipt — user-attested record of civic action outcome.
 * Spec: spec-civic-action-kit-v0.md §2.4
 */
export const DeliveryReceiptSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('hermes-receipt-v1'),

    actionId: z.string().min(1),
    representativeId: z.string().min(1),

    status: z.enum(['success', 'failed', 'user-cancelled']),
    timestamp: z.number().int().nonnegative(),
    intent: DeliveryIntentSchema,

    userAttested: z.boolean(),

    errorMessage: z.string().optional(),
    errorCode: z.string().optional(),

    retryCount: z.number().int().nonnegative(),
    previousReceiptId: z.string().optional(),
  })
  .strict();

export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;
