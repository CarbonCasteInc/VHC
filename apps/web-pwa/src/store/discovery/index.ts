export interface MockDiscoveryStore {
  items: unknown[];
  refresh: () => void;
}

export function createMockDiscoveryStore(): MockDiscoveryStore {
  return {
    items: [],
    refresh: () => undefined
  };
}
