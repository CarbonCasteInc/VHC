export interface MockDelegationStore {
  grants: Record<string, unknown>;
  revokeAll: () => void;
}

export function createMockDelegationStore(): MockDelegationStore {
  return {
    grants: {},
    revokeAll: () => undefined
  };
}
