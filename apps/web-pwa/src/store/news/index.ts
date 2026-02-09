export interface MockNewsStore {
  stories: unknown[];
  refresh: () => void;
}

export function createMockNewsStore(): MockNewsStore {
  return {
    stories: [],
    refresh: () => undefined
  };
}
