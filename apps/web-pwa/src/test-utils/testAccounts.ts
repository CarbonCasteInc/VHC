/**
 * Test account fixtures for multi-account vote persistence testing.
 *
 * Provides BLDT superuser, Lisa, and Larry accounts with distinct
 * nullifiers. The switchAccount flow simulates identity changes and
 * loads/persists per-account vote state via the forum persistence layer.
 *
 * @module testAccounts
 */

import {
  loadVotesFromStorage,
  persistVotes,
} from '../store/forum/persistence';

// ── Shared types ───────────────────────────────────────────────────

/** Vote direction used across persistence and test-account modules. */
export type VoteDirection = 'up' | 'down' | null;

// ── Account fixtures ───────────────────────────────────────────────

export interface TestAccount {
  id: string;
  label: string;
  nullifier: string;
  role: 'superuser' | 'voter';
  trustScore: number;
}

/** BLDT superuser account — full administrative trust. */
export const BLDT_ACCOUNT: TestAccount = {
  id: 'bldt-super',
  label: 'BLDT Superuser',
  nullifier: 'nullifier-bldt-super-test-0xBEEF',
  role: 'superuser',
  trustScore: 1.0,
};

/** Lisa — standard voter account for cross-account testing. */
export const LISA_ACCOUNT: TestAccount = {
  id: 'lisa-voter',
  label: 'Lisa Voter',
  nullifier: 'nullifier-lisa-voter-test-0xCAFE',
  role: 'voter',
  trustScore: 0.8,
};

/** Larry — standard voter account for cross-account testing. */
export const LARRY_ACCOUNT: TestAccount = {
  id: 'larry-voter',
  label: 'Larry Voter',
  nullifier: 'nullifier-larry-voter-test-0xFACE',
  role: 'voter',
  trustScore: 0.75,
};

/** All test accounts for enumeration. */
export const ALL_TEST_ACCOUNTS: readonly TestAccount[] = [
  BLDT_ACCOUNT,
  LISA_ACCOUNT,
  LARRY_ACCOUNT,
];

// ── Active account state ───────────────────────────────────────────

let _activeAccount: TestAccount | null = null;

/** Get the currently active test account, or null if none. */
export function getActiveTestAccount(): TestAccount | null {
  return _activeAccount;
}

/**
 * Switch to a test account by id. Loads that account's persisted
 * votes from storage. Returns the loaded vote map.
 *
 * @throws if accountId doesn't match a known test account
 */
export function switchTestAccount(
  accountId: string,
): Map<string, VoteDirection> {
  const account = ALL_TEST_ACCOUNTS.find((a) => a.id === accountId);
  if (!account) {
    throw new Error(`Unknown test account: ${accountId}`);
  }
  _activeAccount = account;
  return loadVotesFromStorage(account.nullifier);
}

/**
 * Persist votes for the currently active test account.
 *
 * @throws if no account is active
 */
export function persistActiveAccountVotes(
  votes: Map<string, VoteDirection>,
): void {
  if (!_activeAccount) {
    throw new Error('No active test account — call switchTestAccount first');
  }
  persistVotes(_activeAccount.nullifier, votes);
}

/** Reset active account state. For testing teardown. */
export function _resetTestAccountsForTesting(): void {
  _activeAccount = null;
}

// ── Aggregate helpers ──────────────────────────────────────────────

/** Direction-to-delta for aggregate counting. */
function voteDelta(direction: VoteDirection): { up: number; down: number } {
  if (direction === 'up') return { up: 1, down: 0 };
  if (direction === 'down') return { up: 0, down: 1 };
  return { up: 0, down: 0 };
}

export interface AggregateVoteTally {
  targetId: string;
  upvotes: number;
  downvotes: number;
  score: number;
}

/**
 * Aggregate votes across multiple accounts for a set of target ids.
 * Reads each account's persisted votes and tallies up/down totals.
 *
 * This is the cross-account aggregate view — useful for verifying
 * that vote isolation is maintained while aggregates are correct.
 */
export function aggregateVotesAcrossAccounts(
  accounts: readonly TestAccount[],
  targetIds: readonly string[],
): AggregateVoteTally[] {
  const tallies = new Map<string, { up: number; down: number }>();

  for (const tid of targetIds) {
    tallies.set(tid, { up: 0, down: 0 });
  }

  for (const account of accounts) {
    const votes = loadVotesFromStorage(account.nullifier);
    for (const tid of targetIds) {
      const direction = votes.get(tid) ?? null;
      const delta = voteDelta(direction);
      const current = tallies.get(tid)!;
      current.up += delta.up;
      current.down += delta.down;
    }
  }

  return targetIds.map((targetId) => {
    const t = tallies.get(targetId)!;
    return {
      targetId,
      upvotes: t.up,
      downvotes: t.down,
      score: t.up - t.down,
    };
  });
}
