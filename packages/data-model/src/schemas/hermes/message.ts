import { sha256 } from '@vh/crypto';
import { z } from 'zod';

const participantSchema = z.string().min(1);

export const HermesMessageSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal('hermes-message-v0'),
  channelId: z.string().min(1),
  sender: participantSchema,
  recipient: participantSchema,
  timestamp: z.number().int().nonnegative(),
  content: z.string().min(1),
  type: z.enum(['text', 'image', 'file']),
  signature: z.string().min(1),
  deviceId: z.string().min(1).optional()
});

export const HermesChannelSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('hermes-channel-v0'),
    participants: z.array(participantSchema).length(2),
    lastMessageAt: z.number().int().nonnegative(),
    type: z.literal('dm')
  })
  .superRefine((value, ctx) => {
    const uniqueParticipants = new Set(value.participants);
    if (uniqueParticipants.size !== value.participants.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: 'participants must be unique'
      });
    }
  });

export type HermesPayload = {
  text?: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'file';
};

export type HermesMessage = z.infer<typeof HermesMessageSchema>;
export type HermesChannel = z.infer<typeof HermesChannelSchema>;

export async function deriveChannelId(participants: string[]): Promise<string> {
  const sorted = [...participants].sort();
  return sha256(sorted.join('|'));
}
