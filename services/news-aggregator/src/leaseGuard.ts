import type { NewsIngestionLease, VennClient } from '@vh/gun-client';

interface LeaseGuardConfig {
  client: VennClient;
  readLease: (client: VennClient) => Promise<NewsIngestionLease | null>;
  verificationWindowMs: number;
}

export interface LeaseGuard {
  accept(lease: NewsIngestionLease, nowMs: number): void;
  assertHeld(nowMs: number): Promise<void>;
  clear(): void;
  current(): NewsIngestionLease | null;
  releasePayload(nowMs: number): NewsIngestionLease | null;
}

export function createLeaseGuard(config: LeaseGuardConfig): LeaseGuard {
  let lease: NewsIngestionLease | null = null;
  let verifiedLeaseToken: string | null = null;
  let verifiedAtMs = 0;

  const resetVerification = (): void => {
    verifiedLeaseToken = null;
    verifiedAtMs = 0;
  };

  return {
    accept(nextLease: NewsIngestionLease, nowMs: number): void {
      lease = nextLease;
      verifiedLeaseToken = nextLease.lease_token;
      verifiedAtMs = nowMs;
    },
    async assertHeld(nowMs: number): Promise<void> {
      if (!lease) {
        throw new Error('news daemon lease not acquired');
      }
      if (lease.expires_at <= nowMs) {
        throw new Error('news daemon lease expired');
      }
      if (
        verifiedLeaseToken === lease.lease_token &&
        nowMs - verifiedAtMs <= config.verificationWindowMs
      ) {
        return;
      }
      const current = await config.readLease(config.client);
      if (
        !current ||
        current.holder_id !== lease.holder_id ||
        current.lease_token !== lease.lease_token ||
        current.expires_at <= nowMs
      ) {
        resetVerification();
        throw new Error('news daemon lease not held');
      }
      verifiedLeaseToken = current.lease_token;
      verifiedAtMs = nowMs;
    },
    clear(): void {
      lease = null;
      resetVerification();
    },
    current(): NewsIngestionLease | null {
      return lease;
    },
    releasePayload(nowMs: number): NewsIngestionLease | null {
      if (!lease) {
        return null;
      }
      return {
        ...lease,
        heartbeat_at: nowMs,
        expires_at: nowMs,
      };
    },
  };
}
