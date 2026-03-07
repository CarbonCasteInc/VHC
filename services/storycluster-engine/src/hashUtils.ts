import { createHash } from 'node:crypto';

export function sha256Hex(input: string, length = 16): string {
  const digest = createHash('sha256').update(input).digest('hex');
  return length > 0 ? digest.slice(0, length) : digest;
}

export function seededHash32(input: string, seed = 2166136261): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)!;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function stableNumericSeed(input: string): number {
  return seededHash32(input, 0x811c9dc5);
}

export function hexHammingDistance(left: string | undefined, right: string | undefined): number | null {
  if (!left || !right) {
    return null;
  }

  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return null;
  }

  let distance = 0;
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    const leftNibble = Number.parseInt(normalizedLeft[index]!, 16);
    const rightNibble = Number.parseInt(normalizedRight[index]!, 16);
    if (!Number.isFinite(leftNibble) || !Number.isFinite(rightNibble)) {
      return null;
    }
    let value = leftNibble ^ rightNibble;
    while (value > 0) {
      distance += value & 1;
      value >>= 1;
    }
  }

  return distance;
}
