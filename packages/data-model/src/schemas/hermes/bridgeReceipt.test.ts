import { describe, expect, it } from 'vitest';
import { DeliveryReceiptSchema } from './bridgeReceipt';

const validReceipt = {
  id: 'receipt-1',
  schemaVersion: 'hermes-receipt-v1' as const,
  actionId: 'action-1',
  representativeId: 'us-house-ca-11',
  status: 'success' as const,
  timestamp: 1_700_000_000_000,
  intent: 'email' as const,
  userAttested: true,
  retryCount: 0,
};

describe('DeliveryReceiptSchema', () => {
  it('parses a valid receipt', () => {
    const result = DeliveryReceiptSchema.safeParse(validReceipt);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validReceipt);
  });

  it('parses with all optional fields', () => {
    const full = {
      ...validReceipt,
      errorMessage: 'connection refused',
      errorCode: 'E_CONNREFUSED',
      previousReceiptId: 'receipt-0',
    };
    expect(DeliveryReceiptSchema.safeParse(full).success).toBe(true);
  });

  it('accepts all status values', () => {
    for (const status of ['success', 'failed', 'user-cancelled'] as const) {
      expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, status }).success).toBe(true);
    }
  });

  it('accepts all intent values', () => {
    for (const intent of ['email', 'phone', 'share', 'export', 'manual'] as const) {
      expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, intent }).success).toBe(true);
    }
  });

  it('rejects unknown keys (.strict)', () => {
    expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, extra: 1 }).success).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, schemaVersion: 'v2' }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, status: 'pending' }).success).toBe(false);
  });

  it('rejects non-boolean userAttested', () => {
    expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, userAttested: 'yes' }).success).toBe(false);
  });

  it('rejects negative retryCount', () => {
    expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, retryCount: -1 }).success).toBe(false);
  });

  it('rejects non-integer timestamp', () => {
    expect(DeliveryReceiptSchema.safeParse({ ...validReceipt, timestamp: 1.5 }).success).toBe(false);
  });

  it.each([
    'id', 'schemaVersion', 'actionId', 'representativeId',
    'status', 'timestamp', 'intent', 'userAttested', 'retryCount',
  ] as const)(
    'rejects missing required field: %s',
    (field) => {
      const obj = { ...validReceipt };
      delete (obj as Record<string, unknown>)[field];
      expect(DeliveryReceiptSchema.safeParse(obj).success).toBe(false);
    },
  );
});
