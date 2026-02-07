import { useMemo } from 'react';
import { create } from 'zustand';
import { CURATED_PROJECTS } from '@vh/data-model';
import { isE2EMode } from '../store';
import { useXpLedger } from '../store/xpLedger';

export interface Proposal {
  id: string;
  title: string;
  summary: string;
  author: string;
  fundingRequest: number;
  recipient: string;
  votesFor: number;
  votesAgainst: number;
}

export interface VoteInput {
  proposalId: string;
  amount: number;
  direction: 'for' | 'against';
  voterId?: string | null;
}
export type VoteResult = 'recorded' | 'updated' | 'switched';

type StoredVote = { amount: number; direction: 'for' | 'against' };
type StoredVotes = Record<string, StoredVote>;

const VOTE_STORAGE_KEY = 'vh_governance_votes';
export const MIN_TRUST_TO_VOTE = 0.7;

const seedProposals: Proposal[] = [
  {
    id: 'proposal-1',
    title: 'Expand EV Charging Network',
    summary: 'Fund community-owned charging hubs in underserved areas.',
    author: '0xabc',
    fundingRequest: 1500,
    recipient: '0xrecipient1',
    votesFor: 12,
    votesAgainst: 3
  },
  {
    id: 'proposal-2',
    title: 'Civic Data Trust',
    summary: 'Create a public data trust for local governance metrics.',
    author: '0xdef',
    fundingRequest: 2300,
    recipient: '0xrecipient2',
    votesFor: 8,
    votesAgainst: 1
  }
];

function storageKey(voterId: string) {
  return `${VOTE_STORAGE_KEY}:${voterId}`;
}

function mergeVoteStores(a: StoredVotes, b: StoredVotes): StoredVotes {
  return { ...a, ...b };
}

function readFromStorage(storage: Storage | undefined, key: string): StoredVotes {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredVotes;
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    console.warn('[vh:governance] Storage read failed for key', key);
    return {};
  }
}

function readStoreMap(storage: Storage | undefined): Record<string, StoredVotes> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(VOTE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredVotes>;
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    console.warn('[vh:governance] Storage map read failed');
    return {};
  }
}

function loadAllStoredVotes(): Record<string, StoredVotes> {
  try {
    const sessionMap = readStoreMap(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
    const localMap = readStoreMap(typeof localStorage !== 'undefined' ? localStorage : undefined);
    return { ...localMap, ...sessionMap };
  } catch {
    return {};
  }
}

function loadStoredVotes(voterId: string): StoredVotes {
  const combinedMap = loadAllStoredVotes();
  const sessionFallback = readFromStorage(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined, storageKey(voterId));
  const localFallback = readFromStorage(typeof localStorage !== 'undefined' ? localStorage : undefined, storageKey(voterId));
  const mergedFallback = mergeVoteStores(localFallback, sessionFallback);
  return combinedMap[voterId] ?? mergedFallback ?? {};
}

function persistStoredVotes(voterId: string, votes: StoredVotes) {
  try {
    const save = (storage: Storage | undefined) => {
      if (!storage) return;
      const existingMap = readStoreMap(storage);
      storage.setItem(VOTE_STORAGE_KEY, JSON.stringify({ ...existingMap, [voterId]: votes }));
      storage.setItem(storageKey(voterId), JSON.stringify(votes));
    };
    save(typeof localStorage !== 'undefined' ? localStorage : undefined);
    save(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  } catch (err) {
    console.warn('[vh:governance] Storage write failed', err);
  }
}

function applyStoredVotesToProposals(list: Proposal[], votes: StoredVotes): Proposal[] {
  return list.map((p) => {
    const vote = votes[p.id];
    if (!vote) return p;
    return {
      ...p,
      votesFor: vote.direction === 'for' ? p.votesFor + vote.amount : p.votesFor,
      votesAgainst: vote.direction === 'against' ? p.votesAgainst + vote.amount : p.votesAgainst
    };
  });
}

function normalizeTrustScore(trustScore?: number | null): number | null {
  if (trustScore == null || Number.isNaN(trustScore)) return null;
  if (trustScore < 0) return 0;
  if (trustScore > 1) return 1;
  return trustScore;
}

// --- Zustand Store (mirrors useSentimentState pattern) ---

interface GovernanceStore {
  storedVotesMap: Record<string, StoredVotes>;
  lastActions: Record<string, string | null>;
  error: string | null;
  getVotesForVoter: (voterId: string | null | undefined) => StoredVotes;
  getProposals: (voterId: string | null | undefined) => Proposal[];
  getVotedDirections: (voterId: string | null | undefined) => Record<string, 'for' | 'against'>;
  getLastAction: (voterId: string | null | undefined) => string | null;
  submitVote: (params: {
    proposalId: string;
    amount: number;
    direction: 'for' | 'against';
    voterId: string;
    trustScore: number | null;
    proposalTitle?: string;
  }) => VoteResult | void;
  clearError: () => void;
}

export const useGovernanceStore = create<GovernanceStore>((set, get) => ({
  // Synchronously load from storage at module init (like useSentimentState)
  storedVotesMap: loadAllStoredVotes(),
  lastActions: {},
  error: null,

  getVotesForVoter(voterId) {
    if (!voterId) return {};
    const map = get().storedVotesMap;
    return map[voterId] ?? loadStoredVotes(voterId);
  },

  getProposals(voterId) {
    if (!voterId) return seedProposals;
    const votes = get().getVotesForVoter(voterId);
    return applyStoredVotesToProposals(seedProposals, votes);
  },

  getVotedDirections(voterId) {
    if (!voterId) return {};
    const votes = get().getVotesForVoter(voterId);
    return Object.entries(votes).reduce<Record<string, 'for' | 'against'>>((acc, [pid, vote]) => {
      if (vote) acc[pid] = vote.direction;
      return acc;
    }, {});
  },

  getLastAction(voterId) {
    if (!voterId) return null;
    return get().lastActions[voterId] ?? null;
  },

  submitVote({ proposalId, amount, direction, voterId, trustScore, proposalTitle }) {
    if (!amount || amount <= 0) return;
    set({ error: null });

    if (!voterId) {
      set({ error: 'Verified identity required to vote' });
      throw new Error('Verified identity required to vote');
    }

    const normalizedTrust = normalizeTrustScore(trustScore);
    if (normalizedTrust == null || normalizedTrust < MIN_TRUST_TO_VOTE) {
      set({ error: 'Trust score below voting threshold' });
      throw new Error('Trust score below voting threshold');
    }

    // Budget enforcement: check governance vote budget before mutation
    useXpLedger.getState().setActiveNullifier(voterId);
    const budgetCheck = useXpLedger.getState().canPerformAction('governance_votes/day', 1);
    if (!budgetCheck.allowed) {
      set({ error: budgetCheck.reason ?? 'Governance vote budget exhausted' });
      throw new Error(budgetCheck.reason ?? 'Governance vote budget exhausted');
    }

    const currentVotes = get().getVotesForVoter(voterId);
    const prevVote = currentVotes[proposalId];

    const curated = CURATED_PROJECTS[proposalId];
    if (curated) {
      const title = proposalTitle ?? curated.title ?? proposalId;
      console.info(
        `[Season 0] Vote recorded locally for "${title}" (On-chain ID: ${curated.onChainId}). No RVU transaction sent.`
      );
    }

    const nextVotes = { ...currentVotes, [proposalId]: { amount, direction } };
    persistStoredVotes(voterId, nextVotes);

    const title = proposalTitle ?? proposalId;
    set((state) => ({
      storedVotesMap: { ...state.storedVotesMap, [voterId]: nextVotes },
      lastActions: { ...state.lastActions, [voterId]: `Vote recorded for "${title}" (${direction}, ${amount} RVU)` }
    }));

    if (!prevVote) {
      useXpLedger.getState().addXp('project', 5);
    }

    // Consume budget after successful vote
    useXpLedger.getState().consumeAction('governance_votes/day', 1);

    if (prevVote) {
      if (prevVote.direction !== direction) return 'switched';
      return 'updated';
    }
    return 'recorded';
  },

  clearError() {
    set({ error: null });
  }
}));

// --- Hook wrapper (maintains API compatibility) ---

export function useGovernance(voterId?: string | null, trustScore?: number | null) {
  const e2e = isE2EMode();
  const storedVotesMap = useGovernanceStore((s) => s.storedVotesMap);
  const lastActions = useGovernanceStore((s) => s.lastActions);
  const error = useGovernanceStore((s) => s.error);
  const storeSubmitVote = useGovernanceStore((s) => s.submitVote);
  const storeGetLastAction = useGovernanceStore((s) => s.getLastAction);

  // Derive proposals from stored votes (synchronous, no useEffect race)
  const proposals = useMemo(() => {
    if (!voterId) return seedProposals;
    const votes = storedVotesMap[voterId] ?? loadStoredVotes(voterId);
    return applyStoredVotesToProposals(seedProposals, votes);
  }, [voterId, storedVotesMap, e2e]);

  const votedDirections = useMemo(() => {
    if (!voterId) return {};
    const votes = storedVotesMap[voterId] ?? loadStoredVotes(voterId);
    return Object.entries(votes).reduce<Record<string, 'for' | 'against'>>((acc, [pid, vote]) => {
      if (vote) acc[pid] = vote.direction;
      return acc;
    }, {});
  }, [voterId, storedVotesMap]);

  const totalVotes = useMemo(
    () => proposals.reduce((acc, p) => acc + p.votesFor + p.votesAgainst, 0),
    [proposals]
  );

  const submitVote = async ({ proposalId, amount, direction }: VoteInput): Promise<VoteResult | void> => {
    const proposalTitle = proposals.find((p) => p.id === proposalId)?.title;
    return storeSubmitVote({
      proposalId,
      amount,
      direction,
      voterId: voterId!,
      trustScore: trustScore ?? null,
      proposalTitle
    });
  };

  return {
    proposals,
    loading: false,
    error,
    totalVotes,
    submitVote,
    lastAction: storeGetLastAction(voterId) ?? (voterId ? lastActions[voterId] ?? null : null),
    votedDirections
  };
}

export default useGovernance;
