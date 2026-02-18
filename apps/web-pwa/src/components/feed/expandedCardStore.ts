import { create } from 'zustand';

export interface ExpandedCardState {
  readonly expandedStoryId: string | null;
  readonly expand: (storyId: string) => void;
  readonly collapse: () => void;
  readonly isExpanded: (storyId: string) => boolean;
}

export const useExpandedCardStore = create<ExpandedCardState>((set, get) => ({
  expandedStoryId: null,
  expand: (storyId) => {
    set((state) =>
      state.expandedStoryId === storyId ? state : { expandedStoryId: storyId },
    );
  },
  collapse: () => {
    set((state) =>
      state.expandedStoryId === null ? state : { expandedStoryId: null },
    );
  },
  isExpanded: (storyId) => get().expandedStoryId === storyId,
}));

export function resetExpandedCardStore(): void {
  useExpandedCardStore.setState({ expandedStoryId: null });
}
