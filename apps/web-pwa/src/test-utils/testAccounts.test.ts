/**
 * @vitest-environment jsdom
 *
 * jsdom needed for localStorage (used by forum persistence layer).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_TEST_ACCOUNTS,
  BLDT_ACCOUNT,
  LARRY_ACCOUNT,
  LISA_ACCOUNT,
  _resetTestAccountsForTesting,
  aggregateVotesAcrossAccounts,
  getActiveTestAccount,
  persistActiveAccountVotes,
  switchTestAccount,
  type VoteDirection,
} from './testAccounts';
import { DEV_INVITE_CODES } from './devInvite';
import { persistVotes, loadVotesFromStorage } from '../store/forum/persistence';

// ── Helpers ────────────────────────────────────────────────────────

function clearVoteStorage(): void {
  localStorage.clear();
}

// ── Tests ──────────────────────────────────────────────────────────

describe('testAccounts', () => {
  beforeEach(() => {
    _resetTestAccountsForTesting();
    clearVoteStorage();
  });

  afterEach(() => {
    _resetTestAccountsForTesting();
    clearVoteStorage();
  });

  // ── Account fixtures ─────────────────────────────────────────

  describe('account fixtures', () => {
    it('BLDT is a superuser with full trust', () => {
      expect(BLDT_ACCOUNT.role).toBe('superuser');
      expect(BLDT_ACCOUNT.trustScore).toBe(1.0);
      expect(BLDT_ACCOUNT.nullifier).toContain('bldt');
    });

    it('Lisa is a voter with standard trust', () => {
      expect(LISA_ACCOUNT.role).toBe('voter');
      expect(LISA_ACCOUNT.trustScore).toBe(0.8);
      expect(LISA_ACCOUNT.nullifier).toContain('lisa');
    });

    it('Larry is a voter with standard trust', () => {
      expect(LARRY_ACCOUNT.role).toBe('voter');
      expect(LARRY_ACCOUNT.trustScore).toBe(0.75);
      expect(LARRY_ACCOUNT.nullifier).toContain('larry');
    });

    it('all accounts have distinct nullifiers', () => {
      const nullifiers = ALL_TEST_ACCOUNTS.map((a) => a.nullifier);
      expect(new Set(nullifiers).size).toBe(nullifiers.length);
    });

    it('all accounts have distinct ids', () => {
      const ids = ALL_TEST_ACCOUNTS.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('ALL_TEST_ACCOUNTS contains exactly 3 accounts', () => {
      expect(ALL_TEST_ACCOUNTS).toHaveLength(3);
    });
  });

  // ── Account switching ────────────────────────────────────────

  describe('switchTestAccount', () => {
    it('sets active account and returns empty votes initially', () => {
      const votes = switchTestAccount('lisa-voter');
      expect(getActiveTestAccount()).toBe(LISA_ACCOUNT);
      expect(votes.size).toBe(0);
    });

    it('throws for unknown account id', () => {
      expect(() => switchTestAccount('unknown')).toThrow(
        'Unknown test account: unknown',
      );
    });

    it('returns persisted votes after switch', () => {
      // Pre-populate Lisa's votes
      const lisaVotes = new Map<string, 'up' | 'down' | null>([
        ['thread-1', 'up'],
        ['thread-2', 'down'],
      ]);
      persistVotes(LISA_ACCOUNT.nullifier, lisaVotes);

      const loaded = switchTestAccount('lisa-voter');
      expect(loaded.get('thread-1')).toBe('up');
      expect(loaded.get('thread-2')).toBe('down');
    });

    it('switching to different account loads different votes', () => {
      // Lisa votes up on thread-1
      persistVotes(LISA_ACCOUNT.nullifier, new Map([['thread-1', 'up']]));
      // Larry votes down on thread-1
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([['thread-1', 'down']]));

      const lisaVotes = switchTestAccount('lisa-voter');
      expect(lisaVotes.get('thread-1')).toBe('up');

      const larryVotes = switchTestAccount('larry-voter');
      expect(larryVotes.get('thread-1')).toBe('down');
    });
  });

  // ── getActiveTestAccount ─────────────────────────────────────

  describe('getActiveTestAccount', () => {
    it('returns null when no account is active', () => {
      expect(getActiveTestAccount()).toBeNull();
    });

    it('returns the switched-to account', () => {
      switchTestAccount('bldt-super');
      expect(getActiveTestAccount()).toBe(BLDT_ACCOUNT);
    });
  });

  // ── persistActiveAccountVotes ────────────────────────────────

  describe('persistActiveAccountVotes', () => {
    it('throws when no account is active', () => {
      expect(() =>
        persistActiveAccountVotes(new Map()),
      ).toThrow('No active test account');
    });

    it('persists votes for the active account', () => {
      switchTestAccount('lisa-voter');
      const votes = new Map<string, 'up' | 'down' | null>([
        ['comment-1', 'up'],
      ]);
      persistActiveAccountVotes(votes);

      // Verify by loading directly
      const loaded = loadVotesFromStorage(LISA_ACCOUNT.nullifier);
      expect(loaded.get('comment-1')).toBe('up');
    });

    it('does not affect other accounts', () => {
      switchTestAccount('lisa-voter');
      persistActiveAccountVotes(new Map([['t1', 'up']]));

      switchTestAccount('larry-voter');
      persistActiveAccountVotes(new Map([['t1', 'down']]));

      // Verify isolation
      expect(loadVotesFromStorage(LISA_ACCOUNT.nullifier).get('t1')).toBe('up');
      expect(loadVotesFromStorage(LARRY_ACCOUNT.nullifier).get('t1')).toBe('down');
    });
  });

  // ── _resetTestAccountsForTesting ─────────────────────────────

  describe('_resetTestAccountsForTesting', () => {
    it('clears the active account', () => {
      switchTestAccount('bldt-super');
      expect(getActiveTestAccount()).not.toBeNull();
      _resetTestAccountsForTesting();
      expect(getActiveTestAccount()).toBeNull();
    });
  });

  // ── Vote isolation per-account ───────────────────────────────

  describe('vote isolation per-account', () => {
    it('each account maintains independent vote maps', () => {
      // Lisa upvotes thread-1 and thread-2
      persistVotes(LISA_ACCOUNT.nullifier, new Map([
        ['thread-1', 'up'],
        ['thread-2', 'up'],
      ]));

      // Larry downvotes thread-1, upvotes thread-3
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([
        ['thread-1', 'down'],
        ['thread-3', 'up'],
      ]));

      // BLDT has no votes
      // (empty by default)

      // Switch to each and verify isolation
      const lisaVotes = switchTestAccount('lisa-voter');
      expect(lisaVotes.size).toBe(2);
      expect(lisaVotes.get('thread-1')).toBe('up');
      expect(lisaVotes.get('thread-3')).toBeUndefined();

      const larryVotes = switchTestAccount('larry-voter');
      expect(larryVotes.size).toBe(2);
      expect(larryVotes.get('thread-1')).toBe('down');
      expect(larryVotes.get('thread-2')).toBeUndefined();

      const bldtVotes = switchTestAccount('bldt-super');
      expect(bldtVotes.size).toBe(0);
    });

    it('modifying one account votes does not affect another', () => {
      switchTestAccount('lisa-voter');
      persistActiveAccountVotes(new Map([['t1', 'up']]));

      switchTestAccount('larry-voter');
      const larryVotes = loadVotesFromStorage(LARRY_ACCOUNT.nullifier);
      expect(larryVotes.get('t1')).toBeUndefined();
      expect(larryVotes.size).toBe(0);
    });

    it('round-trip: persist, switch away, switch back, verify', () => {
      // Lisa persists
      switchTestAccount('lisa-voter');
      persistActiveAccountVotes(new Map([
        ['t1', 'up'],
        ['t2', 'down'],
      ]));

      // Switch to Larry, persist different votes
      switchTestAccount('larry-voter');
      persistActiveAccountVotes(new Map([
        ['t1', 'down'],
        ['t3', 'up'],
      ]));

      // Switch back to Lisa — her votes should be intact
      const lisaVotes = switchTestAccount('lisa-voter');
      expect(lisaVotes.get('t1')).toBe('up');
      expect(lisaVotes.get('t2')).toBe('down');
      expect(lisaVotes.has('t3')).toBe(false);
    });

    it('null votes are persisted and isolated', () => {
      persistVotes(LISA_ACCOUNT.nullifier, new Map([['t1', null]]));
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([['t1', 'up']]));

      expect(switchTestAccount('lisa-voter').get('t1')).toBeNull();
      expect(switchTestAccount('larry-voter').get('t1')).toBe('up');
    });
  });

  // ── Aggregate behavior ───────────────────────────────────────

  describe('aggregateVotesAcrossAccounts', () => {
    it('returns zero tallies when no votes exist', () => {
      const result = aggregateVotesAcrossAccounts(
        ALL_TEST_ACCOUNTS,
        ['thread-1', 'thread-2'],
      );
      expect(result).toEqual([
        { targetId: 'thread-1', upvotes: 0, downvotes: 0, score: 0 },
        { targetId: 'thread-2', upvotes: 0, downvotes: 0, score: 0 },
      ]);
    });

    it('correctly tallies upvotes across accounts', () => {
      persistVotes(LISA_ACCOUNT.nullifier, new Map([['t1', 'up']]));
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([['t1', 'up']]));
      persistVotes(BLDT_ACCOUNT.nullifier, new Map([['t1', 'up']]));

      const result = aggregateVotesAcrossAccounts(ALL_TEST_ACCOUNTS, ['t1']);
      expect(result[0]).toEqual({
        targetId: 't1',
        upvotes: 3,
        downvotes: 0,
        score: 3,
      });
    });

    it('correctly tallies mixed votes', () => {
      persistVotes(LISA_ACCOUNT.nullifier, new Map([['t1', 'up']]));
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([['t1', 'down']]));
      // BLDT doesn't vote on t1

      const result = aggregateVotesAcrossAccounts(ALL_TEST_ACCOUNTS, ['t1']);
      expect(result[0]).toEqual({
        targetId: 't1',
        upvotes: 1,
        downvotes: 1,
        score: 0,
      });
    });

    it('handles null votes (retracted) correctly', () => {
      persistVotes(LISA_ACCOUNT.nullifier, new Map([['t1', null]]));
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([['t1', 'up']]));

      const result = aggregateVotesAcrossAccounts(ALL_TEST_ACCOUNTS, ['t1']);
      expect(result[0]).toEqual({
        targetId: 't1',
        upvotes: 1,
        downvotes: 0,
        score: 1,
      });
    });

    it('tallies multiple targets independently', () => {
      persistVotes(LISA_ACCOUNT.nullifier, new Map([
        ['t1', 'up'],
        ['t2', 'down'],
      ]));
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([
        ['t1', 'down'],
        ['t2', 'up'],
      ]));

      const result = aggregateVotesAcrossAccounts(ALL_TEST_ACCOUNTS, ['t1', 't2']);

      expect(result[0]).toEqual({
        targetId: 't1', upvotes: 1, downvotes: 1, score: 0,
      });
      expect(result[1]).toEqual({
        targetId: 't2', upvotes: 1, downvotes: 1, score: 0,
      });
    });

    it('works with a subset of accounts', () => {
      persistVotes(LISA_ACCOUNT.nullifier, new Map([['t1', 'up']]));
      persistVotes(LARRY_ACCOUNT.nullifier, new Map([['t1', 'up']]));
      persistVotes(BLDT_ACCOUNT.nullifier, new Map([['t1', 'down']]));

      // Only check Lisa + Larry
      const result = aggregateVotesAcrossAccounts(
        [LISA_ACCOUNT, LARRY_ACCOUNT],
        ['t1'],
      );
      expect(result[0]).toEqual({
        targetId: 't1', upvotes: 2, downvotes: 0, score: 2,
      });
    });

    it('returns results in same order as targetIds input', () => {
      const result = aggregateVotesAcrossAccounts(ALL_TEST_ACCOUNTS, ['z', 'a', 'm']);
      expect(result.map((r) => r.targetId)).toEqual(['z', 'a', 'm']);
    });
  });

  // ── Full multi-account switch flow ───────────────────────────

  describe('full multi-account switch flow', () => {
    it('Lisa and Larry vote independently, aggregate is correct', () => {
      // Lisa votes
      switchTestAccount('lisa-voter');
      persistActiveAccountVotes(new Map([
        ['proposal-1', 'up'],
        ['proposal-2', 'down'],
        ['proposal-3', 'up'],
      ]));

      // Larry votes
      switchTestAccount('larry-voter');
      persistActiveAccountVotes(new Map([
        ['proposal-1', 'down'],
        ['proposal-2', 'up'],
      ]));

      // BLDT votes
      switchTestAccount('bldt-super');
      persistActiveAccountVotes(new Map([
        ['proposal-1', 'up'],
        ['proposal-3', 'down'],
      ]));

      // Verify isolation: switch back to Lisa
      const lisaVotes = switchTestAccount('lisa-voter');
      expect(lisaVotes.get('proposal-1')).toBe('up');
      expect(lisaVotes.get('proposal-2')).toBe('down');
      expect(lisaVotes.get('proposal-3')).toBe('up');

      // Verify aggregate
      const agg = aggregateVotesAcrossAccounts(
        ALL_TEST_ACCOUNTS,
        ['proposal-1', 'proposal-2', 'proposal-3'],
      );

      // proposal-1: Lisa=up, Larry=down, BLDT=up → 2 up, 1 down, score=1
      expect(agg[0]).toEqual({
        targetId: 'proposal-1', upvotes: 2, downvotes: 1, score: 1,
      });

      // proposal-2: Lisa=down, Larry=up, BLDT=none → 1 up, 1 down, score=0
      expect(agg[1]).toEqual({
        targetId: 'proposal-2', upvotes: 1, downvotes: 1, score: 0,
      });

      // proposal-3: Lisa=up, Larry=none, BLDT=down → 1 up, 1 down, score=0
      expect(agg[2]).toEqual({
        targetId: 'proposal-3', upvotes: 1, downvotes: 1, score: 0,
      });
    });
  });

  // ── QA-2: Edge-case coverage for aggregate ───────────────────

  describe('aggregateVotesAcrossAccounts edge cases (QA-2)', () => {
    it('returns empty array when targetIds is empty', () => {
      const result = aggregateVotesAcrossAccounts(ALL_TEST_ACCOUNTS, []);
      expect(result).toEqual([]);
    });

    it('returns all-zero tallies when accounts array is empty', () => {
      const result = aggregateVotesAcrossAccounts([], ['t1', 't2']);
      expect(result).toEqual([
        { targetId: 't1', upvotes: 0, downvotes: 0, score: 0 },
        { targetId: 't2', upvotes: 0, downvotes: 0, score: 0 },
      ]);
    });

    it('returns empty array when both inputs are empty', () => {
      const result = aggregateVotesAcrossAccounts([], []);
      expect(result).toEqual([]);
    });
  });

  // ── QA-3: Cross-module invite→account binding ────────────────

  describe('invite code → test account binding (QA-3)', () => {
    const INVITE_ACCOUNT_MAP: Record<string, string> = {
      'BLDT-SUPER-ADMIN': 'bldt-super',
      'LISA-VOTER-TEST': 'lisa-voter',
      'LARRY-VOTER-TEST': 'larry-voter',
    };

    it('each account-specific invite code maps to a valid test account', () => {
      for (const [code, accountId] of Object.entries(INVITE_ACCOUNT_MAP)) {
        expect(DEV_INVITE_CODES.has(code)).toBe(true);
        // switchTestAccount must not throw for the mapped account id
        const votes = switchTestAccount(accountId);
        expect(votes).toBeInstanceOf(Map);
        _resetTestAccountsForTesting();
      }
    });

    it('all 3 persona accounts have corresponding invite codes', () => {
      for (const account of ALL_TEST_ACCOUNTS) {
        const hasCode = Object.values(INVITE_ACCOUNT_MAP).includes(account.id);
        expect(hasCode).toBe(true);
      }
    });
  });

  // ── QA-1: VoteDirection type alias ───────────────────────────

  describe('VoteDirection type alias (QA-1)', () => {
    it('accepts all valid vote directions', () => {
      const directions: VoteDirection[] = ['up', 'down', null];
      expect(directions).toHaveLength(3);
      // Type-level check: ensure the alias works at runtime
      const voteMap = new Map<string, VoteDirection>([
        ['t1', 'up'],
        ['t2', 'down'],
        ['t3', null],
      ]);
      expect(voteMap.size).toBe(3);
    });
  });
});
