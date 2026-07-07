/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConstituencyProof } from '@vh/types';
import {
  classifyIdentityDenialReason,
  createAdmissionReceipt,
  createDenialReceipt,
  deriveProofRef,
  enqueueDurableVoteIntent,
  evaluateCurrencyDenial,
  VOTE_DENIAL_REASONS,
} from './voteAdmission';
import { getPendingIntents } from './voteIntentQueue';

const STORAGE_KEY = 'vh_vote_intent_queue_v1';

function proofFor(nullifier = 'n'): ConstituencyProof {
  return { district_hash: 'd', nullifier, merkle_root: 'm' };
}

// Field KEYS that must never appear in any '[vh:vote:admission]' payload —
// only topic_id/point_id/admitted/reason are permitted. The reason label may
// legitimately contain the English word "proof" (e.g. "Missing constituency
// proof"); the invariant is that no proof/nullifier MATERIAL is carried, which
// the allowed-key structural check enforces
// (docs/specs/spec-civic-sentiment.md §9.5/§11.2).
const ALLOWED_ADMISSION_KEYS = ['topic_id', 'point_id', 'admitted', 'reason'];

describe('voteAdmission', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('evaluateCurrencyDenial', () => {
    it('returns null when no context is supplied (feature not wired)', () => {
      expect(
        evaluateCurrencyDenial({ context: null, synthesisId: 's', epoch: 0 }),
      ).toBeNull();
      expect(
        evaluateCurrencyDenial({ context: undefined, synthesisId: 's', epoch: 0 }),
      ).toBeNull();
    });

    it('denies a non-current context', () => {
      expect(
        evaluateCurrencyDenial({
          context: { synthesis_id: 's', epoch: 0, accepted_current: false },
          synthesisId: 's',
          epoch: 0,
        }),
      ).toBe(VOTE_DENIAL_REASONS.NON_CURRENT_SYNTHESIS);
    });

    it('denies a mismatched synthesis id or epoch', () => {
      expect(
        evaluateCurrencyDenial({
          context: { synthesis_id: 's-old', epoch: 0, accepted_current: true },
          synthesisId: 's-new',
          epoch: 0,
        }),
      ).toBe(VOTE_DENIAL_REASONS.NON_CURRENT_SYNTHESIS);
      expect(
        evaluateCurrencyDenial({
          context: { synthesis_id: 's', epoch: 1, accepted_current: true },
          synthesisId: 's',
          epoch: 2,
        }),
      ).toBe(VOTE_DENIAL_REASONS.NON_CURRENT_SYNTHESIS);
    });

    it('accepts a matching, current context', () => {
      expect(
        evaluateCurrencyDenial({
          context: { synthesis_id: 's', epoch: 4, accepted_current: true },
          synthesisId: 's',
          epoch: 4,
        }),
      ).toBeNull();
    });
  });

  describe('classifyIdentityDenialReason', () => {
    it('maps expired-session failures to Expired identity', () => {
      expect(
        classifyIdentityDenialReason(
          new Error('MVP LUMA action requires a non-expired active session'),
        ),
      ).toBe(VOTE_DENIAL_REASONS.EXPIRED_IDENTITY);
    });

    it('maps every other identity-readiness failure to Missing identity', () => {
      expect(
        classifyIdentityDenialReason(new Error('MVP LUMA action requires an active identity')),
      ).toBe(VOTE_DENIAL_REASONS.MISSING_IDENTITY);
      expect(
        classifyIdentityDenialReason(
          new Error('MVP LUMA action requires valid beta-local AssuranceEnvelope: missing AssuranceEnvelope'),
        ),
      ).toBe(VOTE_DENIAL_REASONS.MISSING_IDENTITY);
      expect(classifyIdentityDenialReason('not-an-error')).toBe(
        VOTE_DENIAL_REASONS.MISSING_IDENTITY,
      );
    });
  });

  describe('enqueueDurableVoteIntent', () => {
    it('derives, persists, and returns the durable intent record', async () => {
      const result = await enqueueDurableVoteIntent({
        constituencyProof: proofFor('durable-nullifier'),
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
        agreement: 1,
        weight: 1,
        emittedAt: 123,
      });

      expect(result.ok).toBe(true);
      const stored = getPendingIntents();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 0,
        point_id: 'point-1',
        agreement: 1,
        weight: 1,
        seq: 123,
        emitted_at: 123,
      });
      // Durable record carries only an opaque proof_ref, never raw proof.
      expect(stored[0].proof_ref).toMatch(/^pref-/);
      expect(JSON.stringify(stored[0])).not.toContain('durable-nullifier');
    });

    it('records a Write queue failure admission-denial telemetry event on failure', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Empty nullifier makes deriveVoterId reject → enqueue path fails.
      const result = await enqueueDurableVoteIntent({
        constituencyProof: proofFor(''),
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
        agreement: 1,
        weight: 1,
        emittedAt: 123,
      });

      expect(result.ok).toBe(false);
      expect(getPendingIntents()).toHaveLength(0);
      expect(infoSpy).toHaveBeenCalledWith(
        '[vh:vote:admission]',
        expect.objectContaining({
          topic_id: 'topic-1',
          point_id: 'point-1',
          admitted: false,
          reason: VOTE_DENIAL_REASONS.WRITE_QUEUE_FAILURE,
        }),
      );
      // Failure warning must not leak proof material.
      for (const call of warnSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        for (const forbidden of ['district_hash', 'merkle_root']) {
          expect(serialized).not.toContain(forbidden);
        }
      }
    });

    it('reports a Write queue failure when derivation succeeds but the durable write fails', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Derivation succeeds (valid nullifier) but the persist fails (quota):
      // the intent must not be reported as durable.
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const result = await enqueueDurableVoteIntent({
        constituencyProof: proofFor('valid-nullifier'),
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
        agreement: 1,
        weight: 1,
        emittedAt: 123,
      });

      expect(result).toEqual({ ok: false, error: 'vote intent persistence failed' });
      expect(infoSpy).toHaveBeenCalledWith(
        '[vh:vote:admission]',
        expect.objectContaining({
          topic_id: 'topic-1',
          point_id: 'point-1',
          admitted: false,
          reason: VOTE_DENIAL_REASONS.WRITE_QUEUE_FAILURE,
        }),
      );
      setItemSpy.mockRestore();
    });

    it('stringifies a non-Error rejection into the failure result', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const types = await import('@vh/types');
      vi.spyOn(types, 'deriveVoterId').mockRejectedValueOnce('string failure');

      const result = await enqueueDurableVoteIntent({
        constituencyProof: proofFor('n'),
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
        agreement: 1,
        weight: 1,
        emittedAt: 123,
      });

      expect(result).toEqual({ ok: false, error: 'string failure' });
      expect(getPendingIntents()).toHaveLength(0);
    });
  });

  describe('deriveProofRef', () => {
    it('produces an opaque, deterministic reference that omits raw proof material', () => {
      const proof = proofFor('secret-nullifier');
      const ref = deriveProofRef(proof);
      expect(ref).toBe(deriveProofRef(proof));
      expect(ref).toMatch(/^pref-/);
      expect(ref).not.toContain('secret-nullifier');
      expect(ref).not.toContain('d');
    });
  });

  describe('denial telemetry privacy sweep', () => {
    it('carries only the four allowed keys and no proof material for any denial reason', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      // Every canonical denial reason must be loggable without leaking material.
      const reasons = Object.values(VOTE_DENIAL_REASONS);
      for (const reason of reasons) {
        createDenialReceipt('topic-1', 'point-1', 'synth-1', 0, reason);
      }
      // Admission (accepted) path too.
      createAdmissionReceipt('topic-1', 'point-1', 'synth-1', 0);

      expect(infoSpy).toHaveBeenCalled();
      for (const call of infoSpy.mock.calls) {
        expect(call[0]).toBe('[vh:vote:admission]');
        // Structural guard: only topic_id/point_id/admitted/reason. This
        // guarantees no proof/nullifier material can ride along (there is no
        // constituency_proof/nullifier/district_hash/merkle_root key).
        const payload = call[1] as Record<string, unknown>;
        for (const key of Object.keys(payload)) {
          expect(ALLOWED_ADMISSION_KEYS).toContain(key);
        }
      }
    });
  });
});
