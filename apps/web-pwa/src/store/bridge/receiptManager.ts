/**
 * Receipt manager — create, chain, and persist delivery receipts.
 *
 * Outcomes: success, failure, cancel, retry.
 * Retries create chained receipts via previousReceiptId.
 *
 * Spec: spec-civic-action-kit-v0.md §4.4
 */

import type { DeliveryReceipt, DeliveryIntent } from '@vh/data-model';
import { addReceipt, getReceiptsForAction } from './useBridgeStore';

export type ReceiptOutcome = 'success' | 'failed' | 'user-cancelled';

let _receiptCounter = 0;

/** Generate a unique receipt ID. */
async function generateReceiptId(actionId: string, timestamp: number): Promise<string> {
  _receiptCounter += 1;
  const data = new TextEncoder().encode(`receipt:${actionId}:${timestamp}:${_receiptCounter}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `receipt-${hex.slice(0, 16)}`;
}

/**
 * Create a new delivery receipt for a civic action.
 *
 * If the action already has receipts, the new receipt chains
 * to the most recent one via previousReceiptId.
 */
export async function createReceipt(
  nullifier: string,
  actionId: string,
  representativeId: string,
  intent: DeliveryIntent,
  outcome: ReceiptOutcome,
  options?: { errorMessage?: string; errorCode?: string },
): Promise<DeliveryReceipt> {
  const timestamp = Date.now();
  const receiptId = await generateReceiptId(actionId, timestamp);

  // Find existing receipts for chaining
  const existing = getReceiptsForAction(actionId);
  const retryCount = existing.length;
  const previousReceiptId = existing.length > 0
    ? existing[existing.length - 1].id
    : undefined;

  const receipt: DeliveryReceipt = {
    id: receiptId,
    schemaVersion: 'hermes-receipt-v1',
    actionId,
    representativeId,
    status: outcome,
    timestamp,
    intent,
    userAttested: true,
    retryCount,
    previousReceiptId,
    errorMessage: options?.errorMessage,
    errorCode: options?.errorCode,
  };

  await addReceipt(nullifier, receipt);
  return receipt;
}

/**
 * Create a retry receipt chained to the previous attempt.
 */
export async function retryReceipt(
  nullifier: string,
  actionId: string,
  representativeId: string,
  intent: DeliveryIntent,
  errorMessage?: string,
): Promise<DeliveryReceipt> {
  return createReceipt(nullifier, actionId, representativeId, intent, 'failed', {
    errorMessage,
    errorCode: 'E_RETRY',
  });
}
