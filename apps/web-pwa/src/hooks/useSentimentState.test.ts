/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as GunClient from '@vh/gun-client';
import * as DataModel from '@vh/data-model';
import * as ClientResolver from '../store/clientResolver';
import { useSentimentState } from './useSentimentState';
import { createBudgetMock } from '../test-utils/budgetMock';

const TOPIC = 't1';
const POINT = 'p1';
const ANALYSIS = 'a1';

const mockSetActiveNullifier = vi.fn();
const mockCanPerformAction = vi.fn();
const mockConsumeAction = vi.fn();
const budgetMock = createBudgetMock({
  setActiveNullifier: mockSetActiveNullifier,
  canPerformAction: mockCanPerformAction,
  consumeAction: mockConsumeAction
});
let activeNullifier: string | null = null;

function proofFor(nullifier = 'n') {
  return { district_hash: 'd', nullifier, merkle_root: 'm' };
}

async function flushProjection(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('useSentimentState', () => {
  beforeEach(() => {
    localStorage.clear();

    activeNullifier = null;
    mockSetActiveNullifier.mockReset();
    mockCanPerformAction.mockReset();
    mockConsumeAction.mockReset();

    mockSetActiveNullifier.mockImplementation((nullifier: string | null) => {
      activeNullifier = nullifier;
    });
    mockCanPerformAction.mockReturnValue({ allowed: true });

    budgetMock.install();

    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(null);
    vi.spyOn(DataModel, 'deriveAggregateVoterId').mockResolvedValue('voter-1');
    vi.spyOn(GunClient, 'writeSentimentEvent').mockResolvedValue({
      eventId: 'evt-1',
      event: {} as never,
    });
    vi.spyOn(GunClient, 'writeVoterNode').mockResolvedValue({
      point_id: 'p',
      agreement: 1,
      weight: 1,
      updated_at: new Date(0).toISOString(),
    });

    useSentimentState.setState({
      agreements: {},
      lightbulb: {},
      eye: {},
      signals: [],
      setAgreement: useSentimentState.getState().setAgreement,
      recordRead: useSentimentState.getState().recordRead,
      recordEngagement: useSentimentState.getState().recordEngagement,
      getAgreement: useSentimentState.getState().getAgreement,
      getLightbulbWeight: useSentimentState.getState().getLightbulbWeight,
      getEyeWeight: useSentimentState.getState().getEyeWeight
    });
  });

  afterEach(() => {
    budgetMock.restore();
    vi.restoreAllMocks();
  });

  it('cycles agreement and emits signals', () => {
    const proof = proofFor();
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    let agreement = useSentimentState.getState().getAgreement(TOPIC, POINT);
    expect(agreement).toBe(1);
    const firstSignal = useSentimentState.getState().signals.at(-1);
    expect(firstSignal?.agreement).toBe(1);
    expect(firstSignal?.weight).toBe(1);

    // same desired toggles back to neutral
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    agreement = useSentimentState.getState().getAgreement(TOPIC, POINT);
    expect(agreement).toBe(0);
    expect(useSentimentState.getState().signals.at(-1)?.agreement).toBe(0);
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBe(0);

    // switch to disagree
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: -1, constituency_proof: proof });
    agreement = useSentimentState.getState().getAgreement(TOPIC, POINT);
    expect(agreement).toBe(-1);
    const signal = useSentimentState.getState().signals.at(-1);
    expect(signal?.weight).toBeGreaterThan(0);
    expect(signal?.topic_id).toBe(TOPIC);
    expect(signal?.analysis_id).toBe(ANALYSIS);
  });

  it('accumulates eye_weight with decay', () => {
    const first = useSentimentState.getState().recordRead(TOPIC);
    const second = useSentimentState.getState().recordRead(TOPIC);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThanOrEqual(2);
    expect(useSentimentState.getState().getEyeWeight(TOPIC)).toBe(second);
  });

  it('accumulates lightbulb_weight via recordEngagement with decay', () => {
    const first = useSentimentState.getState().recordEngagement(TOPIC);
    const second = useSentimentState.getState().recordEngagement(TOPIC);
    expect(first).toBe(1);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThanOrEqual(2);
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBe(second);
  });

  it('resets lightbulb when all cells return to neutral', () => {
    const proof = proofFor();
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBe(1);
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getAgreement(TOPIC, POINT)).toBe(0);
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBe(0);
  });

  it('recomputes lightbulb based on active cell count with legacy falloff', () => {
    const proof = proofFor();
    // First cell -> weight 1
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1, 5);
    // Second cell -> 1 + (1 - 0.75^(2-1)) = 1.25
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: 'p2', analysisId: ANALYSIS, desired: -1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1.25, 5);
    // Third cell -> 1 + (1 - 0.75^(3-1)) = 1.4375
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: 'p3', analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1.4375, 5);
    // Remove one cell -> back to previous step (1.25)
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: 'p2', analysisId: ANALYSIS, desired: -1, constituency_proof: proof });
    expect(useSentimentState.getState().getAgreement(TOPIC, 'p2')).toBe(0);
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1.25, 5);
  });

  it('calls setActiveNullifier with proof nullifier before budget check', () => {
    useSentimentState
      .getState()
      .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('n1') });

    expect(mockSetActiveNullifier).toHaveBeenCalledWith('n1');
    expect(mockCanPerformAction).toHaveBeenCalledWith('sentiment_votes/day', 1);
    expect(mockSetActiveNullifier.mock.invocationCallOrder[0]).toBeLessThan(mockCanPerformAction.mock.invocationCallOrder[0]);
  });

  it('allowed path mutates state and consumes one budget unit', () => {
    useSentimentState
      .getState()
      .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('allowed') });

    expect(useSentimentState.getState().getAgreement(TOPIC, POINT)).toBe(1);
    expect(useSentimentState.getState().signals).toHaveLength(1);
    expect(mockConsumeAction).toHaveBeenCalledTimes(1);
    expect(mockConsumeAction).toHaveBeenCalledWith('sentiment_votes/day', 1);
  });

  it('denied path does not mutate state or consume budget', () => {
    mockCanPerformAction.mockReturnValue({ allowed: false, reason: 'Budget exhausted' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const before = useSentimentState.getState();
      const result = useSentimentState
        .getState()
        .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('denied') });
      const after = useSentimentState.getState();

      expect(after.agreements).toBe(before.agreements);
      expect(after.lightbulb).toBe(before.lightbulb);
      expect(after.signals).toBe(before.signals);
      expect(mockConsumeAction).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Budget denied:', 'Budget exhausted');
      expect(result).toEqual({ denied: true, reason: 'Budget exhausted' });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('denied path with no reason uses fallback', () => {
    mockCanPerformAction.mockReturnValue({ allowed: false });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = useSentimentState
        .getState()
        .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('no-reason') });

      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Budget denied:', 'Daily limit reached for sentiment_votes/day');
      expect(result).toEqual({ denied: true, reason: 'Daily limit reached for sentiment_votes/day' });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('denied path with empty string reason uses fallback', () => {
    mockCanPerformAction.mockReturnValue({ allowed: false, reason: '' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = useSentimentState
        .getState()
        .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('empty') });

      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Budget denied:', 'Daily limit reached for sentiment_votes/day');
      expect(result).toEqual({ denied: true, reason: 'Daily limit reached for sentiment_votes/day' });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('missing proof returns denial object', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = useSentimentState.getState().setAgreement({
        topicId: TOPIC,
        pointId: POINT,
        analysisId: ANALYSIS,
        desired: 1
      });

      expect(result).toEqual({ denied: true, reason: 'Missing constituency proof' });
      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Missing constituency proof; SentimentSignal not emitted');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('allowed path returns void (undefined)', () => {
    const result = useSentimentState
      .getState()
      .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('ok') });

    expect(result).toBeUndefined();
  });

  it('allows 200 sentiment votes and denies the 201st', () => {
    let checks = 0;
    mockCanPerformAction.mockImplementation(() => {
      checks += 1;
      if (checks <= 200) return { allowed: true };
      return { allowed: false, reason: 'Daily limit reached for sentiment_votes/day' };
    });

    for (let i = 1; i <= 200; i += 1) {
      useSentimentState.getState().setAgreement({
        topicId: TOPIC,
        pointId: `p${i}`,
        analysisId: ANALYSIS,
        desired: 1,
        constituency_proof: proofFor('limit-200')
      });
    }

    const beforeDeniedSignals = useSentimentState.getState().signals.length;
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'p201',
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('limit-200')
    });

    expect(Object.keys(useSentimentState.getState().agreements)).toHaveLength(200);
    expect(useSentimentState.getState().getAgreement(TOPIC, 'p201')).toBe(0);
    expect(useSentimentState.getState().signals).toHaveLength(beforeDeniedSignals);
    expect(mockCanPerformAction).toHaveBeenCalledTimes(201);
    expect(mockConsumeAction).toHaveBeenCalledTimes(200);
  });

  it('enforces budget per nullifier isolation', () => {
    const checksByNullifier: Record<string, number> = {};
    mockCanPerformAction.mockImplementation(() => {
      const nullifier = activeNullifier ?? '';
      checksByNullifier[nullifier] = (checksByNullifier[nullifier] ?? 0) + 1;
      if (nullifier === 'a' && checksByNullifier[nullifier] > 1) {
        return { allowed: false, reason: 'Budget exhausted for a' };
      }
      return { allowed: true };
    });

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'pa-1',
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('a')
    });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'pb-1',
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('b')
    });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'pa-2',
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('a')
    });

    expect(useSentimentState.getState().getAgreement(TOPIC, 'pa-1')).toBe(1);
    expect(useSentimentState.getState().getAgreement(TOPIC, 'pb-1')).toBe(1);
    expect(useSentimentState.getState().getAgreement(TOPIC, 'pa-2')).toBe(0);
    expect(mockSetActiveNullifier).toHaveBeenNthCalledWith(1, 'a');
    expect(mockSetActiveNullifier).toHaveBeenNthCalledWith(2, 'b');
    expect(mockSetActiveNullifier).toHaveBeenNthCalledWith(3, 'a');
    expect(mockConsumeAction).toHaveBeenCalledTimes(2);
  });

  it('missing proof skips all budget APIs', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1
    });

    expect(mockSetActiveNullifier).not.toHaveBeenCalled();
    expect(mockCanPerformAction).not.toHaveBeenCalled();
    expect(mockConsumeAction).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('toggle-to-neutral still consumes budget', () => {
    const proof = proofFor('toggle');

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proof
    });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proof
    });

    expect(useSentimentState.getState().getAgreement(TOPIC, POINT)).toBe(0);
    expect(mockConsumeAction).toHaveBeenCalledTimes(2);
  });

  it('denied call does not emit SentimentSignal', () => {
    mockCanPerformAction.mockReturnValue({ allowed: false, reason: 'Budget exhausted' });
    const beforeCount = useSentimentState.getState().signals.length;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      useSentimentState.getState().setAgreement({
        topicId: TOPIC,
        pointId: POINT,
        analysisId: ANALYSIS,
        desired: 1,
        constituency_proof: proofFor('signal-denied')
      });

      expect(useSentimentState.getState().signals).toHaveLength(beforeCount);
      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Budget denied:', 'Budget exhausted');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('emits synthesis_id + epoch when explicit context is provided', () => {
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('explicit'),
    });

    const signal = useSentimentState.getState().signals.at(-1);
    expect(signal?.synthesis_id).toBe('synth-9');
    expect(signal?.epoch).toBe(4);
    expect(useSentimentState.getState().getAgreement(TOPIC, POINT, 'synth-9', 4)).toBe(1);
  });

  it('falls back to analysis_id compatibility context when synthesis inputs are absent', () => {
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('compat'),
    });

    const signal = useSentimentState.getState().signals.at(-1);
    expect(signal?.synthesis_id).toBe(ANALYSIS);
    expect(signal?.epoch).toBe(0);
    expect(signal?.analysis_id).toBe(ANALYSIS);
  });

  it('projects accepted votes to encrypted outbox + aggregate voter nodes', async () => {
    const fakeClient = {
      gun: { user: () => ({}) },
      mesh: { get: () => ({}) },
    } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    const deriveVoterIdSpy = vi
      .spyOn(DataModel, 'deriveAggregateVoterId')
      .mockResolvedValue('voter-9');
    const writeEventSpy = vi.spyOn(GunClient, 'writeSentimentEvent');
    const writeVoterSpy = vi.spyOn(GunClient, 'writeVoterNode');

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('projected'),
    });

    await flushProjection();

    expect(writeEventSpy).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        topic_id: TOPIC,
        synthesis_id: 'synth-9',
        epoch: 4,
        point_id: POINT,
        agreement: 1,
      }),
    );

    expect(deriveVoterIdSpy).toHaveBeenCalledWith({
      nullifier: 'projected',
      topic_id: TOPIC,
    });

    expect(writeVoterSpy).toHaveBeenCalledWith(
      fakeClient,
      TOPIC,
      'synth-9',
      4,
      'voter-9',
      expect.objectContaining({
        point_id: POINT,
        agreement: 1,
        weight: 1,
        updated_at: expect.any(String),
      }),
    );

    const aggregatePayload = writeVoterSpy.mock.calls.at(-1)?.[5] as Record<string, unknown>;
    expect(aggregatePayload).not.toHaveProperty('constituency_proof');
    expect(aggregatePayload).not.toHaveProperty('nullifier');
  });

  it('projection failures do not rollback local vote state', async () => {
    const fakeClient = {
      gun: { user: () => ({}) },
      mesh: { get: () => ({}) },
    } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    vi.spyOn(GunClient, 'writeSentimentEvent').mockRejectedValue(new Error('outbox-write-failed'));
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue(new Error('aggregate-write-failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('projected-err'),
    });

    await flushProjection();

    expect(useSentimentState.getState().getAgreement(TOPIC, POINT, 'synth-9', 4)).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:sentiment] Failed to write encrypted sentiment event:',
      expect.any(Error),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:sentiment] Failed to project aggregate voter node:',
      expect.any(Error),
    );
  });
});
