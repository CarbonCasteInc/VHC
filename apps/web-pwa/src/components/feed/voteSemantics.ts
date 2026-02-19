export type Agreement = -1 | 0 | 1;

/**
 * Legacy parity toggle semantics:
 * - same vote => neutral
 * - opposite vote => switch
 */
export function resolveNextAgreement(current: Agreement, desired: Exclude<Agreement, 0>): Agreement {
  return current === desired ? 0 : desired;
}

function clampWeight(value: number): number {
  return Math.max(0, Math.min(2, value));
}

/**
 * Legacy per-user falloff formula:
 * weight = 1 + (1 - 0.75^(count - 1))
 * bounded in [0, 2]
 */
export function legacyWeightForActiveCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  const normalizedCount = Math.floor(count);
  const weight = 1 + (1 - Math.pow(0.75, normalizedCount - 1));
  return clampWeight(weight);
}
