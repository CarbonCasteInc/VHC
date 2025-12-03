import { describe, expect, it } from 'vitest';
import { HermesChannelSchema, HermesMessageSchema, deriveChannelId } from './message';

describe('HermesMessageSchema', () => {
  it('accepts a valid message', () => {
    const parsed = HermesMessageSchema.parse({
      id: 'msg-1',
      schemaVersion: 'hermes-message-v0',
      channelId: 'channel-1',
      sender: 'alice-nullifier',
      recipient: 'bob-nullifier',
      timestamp: Date.now(),
      content: 'ciphertext',
      type: 'text',
      signature: 'signed-payload',
      deviceId: 'device-1'
    });

    expect(parsed.deviceId).toBe('device-1');
  });

  it('rejects an invalid type', () => {
    expect(() =>
      HermesMessageSchema.parse({
        id: 'msg-2',
        schemaVersion: 'hermes-message-v0',
        channelId: 'channel-1',
        sender: 'alice-nullifier',
        recipient: 'bob-nullifier',
        timestamp: Date.now(),
        content: 'ciphertext',
        type: 'video',
        signature: 'signed-payload'
      })
    ).toThrow();
  });

  it('enforces schema version literal', () => {
    const result = HermesMessageSchema.safeParse({
      id: 'msg-3',
      schemaVersion: 'wrong',
      channelId: 'channel-1',
      sender: 'alice-nullifier',
      recipient: 'bob-nullifier',
      timestamp: Date.now(),
      content: 'ciphertext',
      type: 'text',
      signature: 'signed-payload'
    });
    expect(result.success).toBe(false);
  });
});

describe('HermesChannelSchema', () => {
  it('accepts a valid dm channel', () => {
    const channel = HermesChannelSchema.parse({
      id: 'channel-1',
      schemaVersion: 'hermes-channel-v0',
      participants: ['alice-nullifier', 'bob-nullifier'],
      lastMessageAt: Date.now(),
      type: 'dm'
    });
    expect(channel.participants.length).toBe(2);
  });

  it('rejects duplicate participants', () => {
    const result = HermesChannelSchema.safeParse({
      id: 'channel-1',
      schemaVersion: 'hermes-channel-v0',
      participants: ['alice-nullifier', 'alice-nullifier'],
      lastMessageAt: Date.now(),
      type: 'dm'
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-dm channel types', () => {
    expect(() =>
      HermesChannelSchema.parse({
        id: 'channel-1',
        schemaVersion: 'hermes-channel-v0',
        participants: ['alice-nullifier', 'bob-nullifier'],
        lastMessageAt: Date.now(),
        type: 'group'
      })
    ).toThrow();
  });
});

describe('deriveChannelId', () => {
  it('is deterministic regardless of participant order', async () => {
    const inputs = ['bob-nullifier', 'alice-nullifier'];
    const first = await deriveChannelId(inputs);
    const second = await deriveChannelId(['alice-nullifier', 'bob-nullifier']);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('yields different ids for different participant sets', async () => {
    const a = await deriveChannelId(['alice', 'bob']);
    const b = await deriveChannelId(['alice', 'carol']);
    expect(a).not.toBe(b);
  });
});
