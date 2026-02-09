export interface MockSynthesisStore {
  topics: Record<string, unknown>;
  refreshTopic: (topicId: string) => void;
}

export function createMockSynthesisStore(): MockSynthesisStore {
  return {
    topics: {},
    refreshTopic: (_topicId: string) => undefined
  };
}
