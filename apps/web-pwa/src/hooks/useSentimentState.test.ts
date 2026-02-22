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
    vi.spyOn(DataModel, 'deriveVoteIntentId').mockResolvedValue('intent-default');
    vi.spyOn(GunClient, 'writeSentimentEvent').mockResolvedValue({
      eventId: 'evt-1',
      event: {} as never,
      ack: {
        acknowledged: true,
        timedOut: false,
      },
    });
    vi.spyOn(GunClient, 'writeVoterNode').mockResolvedValue({
      point_id: 'p',
      agreement: 1,
      weight: 1,
      updated_at: new Date(0).toISOString(),
    });

    useSentimentState.setState({
      agreements: {},
      pointIdAliases: {},
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
    expect(second).toBeLessThan(2);
    expect(useSentimentState.getState().getEyeWeight(TOPIC)).toBe(second);
  });

  it('accumulates lightbulb_weight via recordEngagement with decay', () => {
    const first = useSentimentState.getState().recordEngagement(TOPIC);
    const second = useSentimentState.getState().recordEngagement(TOPIC);
    expect(first).toBe(1);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(2);
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBe(second);
  });

  it('clamps recordRead/recordEngagement weights for NaN, negative, and >2 inputs', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      eye: { [TOPIC]: Number.NaN },
      lightbulb: { [TOPIC]: -5 },
    });

    const eyeFromNaN = useSentimentState.getState().recordRead(TOPIC);
    expect(eyeFromNaN).toBe(0);

    const lightbulbFromNegative = useSentimentState.getState().recordEngagement(TOPIC);
    expect(lightbulbFromNegative).toBe(0);

    useSentimentState.setState({
      ...useSentimentState.getState(),
      eye: { [TOPIC]: 3 },
      lightbulb: { [TOPIC]: 3 },
    });

    const eyeFromAboveTwo = useSentimentState.getState().recordRead(TOPIC);
    const lightbulbFromAboveTwo = useSentimentState.getState().recordEngagement(TOPIC);
    expect(eyeFromAboveTwo).toBe(1.95);
    expect(lightbulbFromAboveTwo).toBe(1.95);
  });

  it('returns zero fallback weights for unknown topics', () => {
    expect(useSentimentState.getState().getLightbulbWeight('unknown-topic')).toBe(0);
    expect(useSentimentState.getState().getEyeWeight('unknown-topic')).toBe(0);
  });

  it('resets lightbulb when all cells return to neutral', () => {
    const proof = proofFor();
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBe(1);
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getAgreement(TOPIC, POINT)).toBe(0);
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBe(0);
  });

  it('recomputes lightbulb based on active cell count with civic decay cap', () => {
    const proof = proofFor();
    // First cell -> weight 1
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1, 5);
    // Second cell -> civic decay closed form (cap=1.95, alpha=0.3) => 1.285
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: 'p2', analysisId: ANALYSIS, desired: -1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1.285, 5);
    // Third cell -> civic decay closed form (cap=1.95, alpha=0.3) => 1.4845
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: 'p3', analysisId: ANALYSIS, desired: 1, constituency_proof: proof });
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1.4845, 5);
    // Remove one cell -> back to previous step (1.285)
    useSentimentState.getState().setAgreement({ topicId: TOPIC, pointId: 'p2', analysisId: ANALYSIS, desired: -1, constituency_proof: proof });
    expect(useSentimentState.getState().getAgreement(TOPIC, 'p2')).toBe(0);
    expect(useSentimentState.getState().getLightbulbWeight(TOPIC)).toBeCloseTo(1.285, 5);
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
      expect(result).toMatchObject({ accepted: false, reason: 'Budget exhausted' });
      expect(result.receipt_id).toMatch(/^deny-/);
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
      expect(result).toMatchObject({ accepted: false, reason: 'Daily limit reached for sentiment_votes/day' });
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
      expect(result).toMatchObject({ accepted: false, reason: 'Daily limit reached for sentiment_votes/day' });
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

      expect(result).toMatchObject({ accepted: false, reason: 'Missing constituency proof' });
      expect(result.receipt_id).toMatch(/^deny-/);
      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Missing constituency proof; SentimentSignal not emitted');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('missing point id returns denial object', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = useSentimentState.getState().setAgreement({
        topicId: TOPIC,
        pointId: '   ',
        analysisId: ANALYSIS,
        desired: 1,
        constituency_proof: proofFor('missing-point-id')
      });

      expect(result).toMatchObject({ accepted: false, reason: 'Missing point_id' });
      expect(result.receipt_id).toMatch(/^deny-/);
      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Missing point_id; SentimentSignal not emitted');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('missing synthesis context returns denial object', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = useSentimentState.getState().setAgreement({
        topicId: TOPIC,
        pointId: POINT,
        desired: 1,
        constituency_proof: proofFor('missing-context')
      });

      expect(result).toMatchObject({ accepted: false, reason: 'Missing synthesis context' });
      expect(result.receipt_id).toMatch(/^deny-/);
      expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Missing synthesis context; SentimentSignal not emitted');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('desired=0 writes explicit neutral agreement', () => {
    useSentimentState
      .getState()
      .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('neutralize') });

    useSentimentState
      .getState()
      .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 0, constituency_proof: proofFor('neutralize') });

    expect(useSentimentState.getState().getAgreement(TOPIC, POINT)).toBe(0);
    expect(useSentimentState.getState().signals.at(-1)?.agreement).toBe(0);
  });

  it('allowed path returns VoteAdmissionReceipt with accepted: true', () => {
    const result = useSentimentState
      .getState()
      .setAgreement({ topicId: TOPIC, pointId: POINT, analysisId: ANALYSIS, desired: 1, constituency_proof: proofFor('ok') });

    expect(result).toMatchObject({ accepted: true, topic_id: TOPIC, point_id: POINT });
    expect(result.receipt_id).toMatch(/^admit-/);
    expect(result.admitted_at).toBeGreaterThan(0);
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

  it('treats blank synthesisId and invalid epoch as legacy compatibility context', () => {
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: '   ',
      epoch: Number.NaN,
      analysisId: 'legacy-analysis',
      desired: 1,
      constituency_proof: proofFor('compat-invalid-epoch'),
    });

    const signal = useSentimentState.getState().signals.at(-1);
    expect(signal?.synthesis_id).toBe('legacy-analysis');
    expect(signal?.epoch).toBe(0);
  });

  it('prefers canonical synthesis point ID and falls back to legacy point ID', () => {
    const legacyContextKey = `${TOPIC}:synth-9:4:legacy-point`;
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: { [legacyContextKey]: -1 },
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });

    expect(
      useSentimentState
        .getState()
        .getAgreement(TOPIC, 'synth-point', 'synth-9', 4, 'legacy-point'),
    ).toBe(-1);

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'legacy-point',
      synthesisPointId: 'synth-point',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('compat-upgrade'),
    });

    expect(
      useSentimentState
        .getState()
        .getAgreement(TOPIC, 'synth-point', 'synth-9', 4, 'legacy-point'),
    ).toBe(1);
  });

  it('dual-write keeps local legacy+canonical keys but emits canonical signal point_id', () => {
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'legacy-abc',
      synthesisPointId: 'synth-xyz',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('dual-write'),
    });

    const signal = useSentimentState.getState().signals.at(-1);
    expect(signal?.point_id).toBe('synth-xyz');

    const persistedAgreements = JSON.parse(localStorage.getItem('vh_sentiment_agreements_v1') ?? '{}') as Record<string, number>;
    expect(persistedAgreements).toMatchObject({
      [`${TOPIC}:synth-9:4:synth-xyz`]: 1,
      [`${TOPIC}:synth-9:4:legacy-abc`]: 1,
    });
  });

  it('dual-write migration does not inflate active-count weights', () => {
    const dualProof = proofFor('dual-weight');

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'legacy-1',
      synthesisPointId: 'synth-1',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: dualProof,
    });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'legacy-2',
      synthesisPointId: 'synth-2',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: dualProof,
    });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'legacy-3',
      synthesisPointId: 'synth-3',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: dualProof,
    });

    const dualWeight = useSentimentState.getState().getLightbulbWeight(TOPIC);
    expect(dualWeight).toBeCloseTo(1.4845, 5);

    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });

    const canonicalProof = proofFor('canonical-weight');
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'synth-1',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: canonicalProof,
    });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'synth-2',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: canonicalProof,
    });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'synth-3',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: canonicalProof,
    });

    const canonicalWeight = useSentimentState.getState().getLightbulbWeight(TOPIC);
    expect(dualWeight).toBeCloseTo(canonicalWeight, 5);
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

  it('handles non-Error projection failures and combines both failure messages', async () => {
    const fakeClient = {
      gun: { user: () => ({}) },
      mesh: { get: () => ({}) },
    } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    vi.spyOn(GunClient, 'writeSentimentEvent').mockRejectedValue('outbox-string-failure');
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue('aggregate-string-failure');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('projected-err-string'),
    });

    await flushProjection();

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({
        success: false,
        error: 'outbox-string-failure; aggregate-string-failure',
      }),
    );

    warnSpy.mockRestore();
  });

  it('handles aggregate-only non-Error failures when event write succeeds', async () => {
    const fakeClient = {
      gun: { user: () => ({}) },
      mesh: { get: () => ({}) },
    } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    vi.spyOn(GunClient, 'writeSentimentEvent').mockResolvedValue({
      eventId: 'ok',
      event: {} as never,
      ack: {
        acknowledged: true,
        timedOut: false,
      },
    });
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue('aggregate-only-string-failure');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('projected-err-string-aggregate-only'),
    });

    await flushProjection();

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({
        success: false,
        error: 'aggregate-only-string-failure',
      }),
    );

    warnSpy.mockRestore();
  });

  it('prefers canonical contextual read before legacy fallback when both exist', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {
        [`${TOPIC}:synth-1:0:canonical-point`]: 1,
        [`${TOPIC}:legacy-point`]: -1,
      },
    });

    expect(
      useSentimentState.getState().getAgreement(
        TOPIC,
        'canonical-point',
        'synth-1',
        0,
        'legacy-point',
      ),
    ).toBe(1);
  });

  it('falls back to suffix scan when contextual and legacy keys are absent', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {
        [`${TOPIC}:synth-22:7:suffix-point`]: -1,
      },
    });

    expect(useSentimentState.getState().getAgreement(TOPIC, 'suffix-point')).toBe(-1);
  });

  it('returns 0 when contextual key exists with undefined value', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {
        [`${TOPIC}:synth-9:4:${POINT}`]: undefined as unknown as -1 | 0 | 1,
      },
    });

    expect(useSentimentState.getState().getAgreement(TOPIC, POINT, 'synth-9', 4)).toBe(0);
  });

  it('returns 0 when legacy key exists with undefined value', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {
        [`${TOPIC}:${POINT}`]: undefined as unknown as -1 | 0 | 1,
      },
    });

    expect(useSentimentState.getState().getAgreement(TOPIC, POINT)).toBe(0);
  });

  it('returns 0 when suffix fallback key exists with undefined value', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {
        [`${TOPIC}:synth-22:7:suffix-point`]: undefined as unknown as -1 | 0 | 1,
      },
    });

    expect(useSentimentState.getState().getAgreement(TOPIC, 'suffix-point')).toBe(0);
  });

  it('suffix scan skips unrelated topic keys while searching candidates', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {
        ['other-topic:synth-22:7:suffix-point']: 1,
        [`${TOPIC}:synth-22:7:suffix-point`]: -1,
      },
    });

    expect(useSentimentState.getState().getAgreement(TOPIC, 'suffix-point')).toBe(-1);
  });

  it('removes legacy flat keys after contextual write', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {
        [`${TOPIC}:legacy-point`]: 1,
        [`${TOPIC}:synth-point`]: -1,
      },
    });

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: 'legacy-point',
      synthesisPointId: 'synth-point',
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('cleanup'),
    });

    const agreements = useSentimentState.getState().agreements;
    expect(agreements[`${TOPIC}:legacy-point`]).toBeUndefined();
    expect(agreements[`${TOPIC}:synth-point`]).toBeUndefined();
    expect(agreements[`${TOPIC}:synth-9:4:synth-point`]).toBe(1);
  });

  it('emits vote-admission telemetry for denied writes', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
    });

    expect(infoSpy).toHaveBeenCalledWith('[vh:vote:admission]', {
      topic_id: TOPIC,
      point_id: POINT,
      admitted: false,
      reason: 'Missing constituency proof',
    });

    infoSpy.mockRestore();
  });

  it('emits vote-admission + mesh-write telemetry for successful local admission', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('telemetry'),
    });

    await flushProjection();

    expect(infoSpy).toHaveBeenCalledWith('[vh:vote:admission]', {
      topic_id: TOPIC,
      point_id: POINT,
      admitted: true,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({
        topic_id: TOPIC,
        point_id: POINT,
        success: false,
        error: 'client-unavailable',
      }),
    );

    infoSpy.mockRestore();
  });

  it('emits transport-unavailable mesh-write telemetry when client lacks transports', async () => {
    const partialClient = { gun: {}, mesh: {} } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(partialClient);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const writeEventSpy = vi.spyOn(GunClient, 'writeSentimentEvent');
    const writeVoterSpy = vi.spyOn(GunClient, 'writeVoterNode');

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('no-transports'),
    });

    await flushProjection();

    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({
        topic_id: TOPIC,
        point_id: POINT,
        success: false,
        error: 'sentiment-transport-unavailable',
      }),
    );
    expect(writeEventSpy).not.toHaveBeenCalled();
    expect(writeVoterSpy).not.toHaveBeenCalled();

    infoSpy.mockRestore();
  });

  it('marks mesh-write timeout as failed telemetry', async () => {
    const fakeClient = {
      gun: { user: () => ({}) },
      mesh: { get: () => ({}) },
    } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    vi.spyOn(GunClient, 'writeSentimentEvent').mockResolvedValue({
      eventId: 'evt-timeout',
      event: {} as never,
      ack: {
        acknowledged: false,
        timedOut: true,
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('telemetry-timeout'),
    });

    await flushProjection();

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({
        topic_id: TOPIC,
        point_id: POINT,
        success: false,
        timed_out: true,
        error: 'sentiment-outbox-timeout',
      }),
    );

    warnSpy.mockRestore();
  });

  it('marks non-timeout non-acknowledged event writes as failed telemetry', async () => {
    const fakeClient = {
      gun: { user: () => ({}) },
      mesh: { get: () => ({}) },
    } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    vi.spyOn(GunClient, 'writeSentimentEvent').mockResolvedValue({
      eventId: 'evt-unacked',
      event: {} as never,
      ack: {
        acknowledged: false,
        timedOut: false,
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('telemetry-unacked'),
    });

    await flushProjection();

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({
        topic_id: TOPIC,
        point_id: POINT,
        success: false,
        timed_out: false,
        error: 'sentiment-outbox-not-acknowledged',
      }),
    );

    warnSpy.mockRestore();
  });

  it('emits successful mesh-write telemetry when projection succeeds', async () => {
    const fakeClient = {
      gun: { user: () => ({}) },
      mesh: { get: () => ({}) },
    } as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-9',
      epoch: 4,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('telemetry-success'),
    });

    await flushProjection();

    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({
        topic_id: TOPIC,
        point_id: POINT,
        success: true,
      }),
    );

    infoSpy.mockRestore();
  });

  // ─── B1: Admission Receipt Tests ───────────────────────────────────────

  it('setAgreement returns VoteAdmissionReceipt with accepted: true on success', () => {
    const result = useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-b1',
      epoch: 1,
      desired: 1,
      constituency_proof: proofFor('b1-success'),
    });

    expect(result.accepted).toBe(true);
    expect(result.receipt_id).toMatch(/^admit-/);
    expect(result.receipt_id.length).toBeGreaterThan(0);
    expect(result.topic_id).toBe(TOPIC);
    expect(result.synthesis_id).toBe('synth-b1');
    expect(result.epoch).toBe(1);
    expect(result.point_id).toBe(POINT);
    expect(result.admitted_at).toBeGreaterThan(0);
  });

  it('setAgreement returns VoteAdmissionReceipt with accepted: false on each denial path', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Missing proof
    const proofResult = useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
    });
    expect(proofResult.accepted).toBe(false);
    expect(proofResult.reason).toBe('Missing constituency proof');
    expect(proofResult.receipt_id).toMatch(/^deny-/);

    // Missing point_id
    const pointResult = useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: '   ',
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('b1-deny-point'),
    });
    expect(pointResult.accepted).toBe(false);
    expect(pointResult.reason).toBe('Missing point_id');

    // Missing synthesis context
    const contextResult = useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      desired: 1,
      constituency_proof: proofFor('b1-deny-context'),
    });
    expect(contextResult.accepted).toBe(false);
    expect(contextResult.reason).toBe('Missing synthesis context');

    // Budget exceeded
    mockCanPerformAction.mockReturnValue({ allowed: false, reason: 'Budget exhausted' });
    const budgetResult = useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('b1-deny-budget'),
    });
    expect(budgetResult.accepted).toBe(false);
    expect(budgetResult.reason).toBe('Budget exhausted');

    warnSpy.mockRestore();
  });

  it('admitted vote creates VoteIntentRecord in durable queue', async () => {
    vi.spyOn(DataModel, 'deriveAggregateVoterId').mockResolvedValue('voter-intent');
    vi.spyOn(DataModel, 'deriveVoteIntentId').mockResolvedValue('intent-123');

    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      synthesisId: 'synth-intent',
      epoch: 2,
      desired: 1,
      constituency_proof: proofFor('intent-proof'),
    });

    // Wait for async intent enqueue
    await flushProjection();

    const raw = localStorage.getItem('vh_vote_intent_queue_v1');
    expect(raw).not.toBeNull();
    const queue = JSON.parse(raw!) as Array<{ intent_id: string; voter_id: string; topic_id: string; proof_ref: string }>;
    expect(queue.length).toBeGreaterThanOrEqual(1);
    const intent = queue.find((r) => r.intent_id === 'intent-123');
    expect(intent).toBeDefined();
    expect(intent!.voter_id).toBe('voter-intent');
    expect(intent!.topic_id).toBe(TOPIC);
    // proof_ref is opaque, not the raw proof
    expect(intent!.proof_ref).toMatch(/^pref-/);
    expect(intent!.proof_ref).not.toContain('intent-proof');
  });

  it('receipt_id is always a non-empty string', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Denied path
    const denied = useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      desired: 1,
    });
    expect(typeof denied.receipt_id).toBe('string');
    expect(denied.receipt_id.length).toBeGreaterThan(0);

    // Admitted path
    const admitted = useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('receipt-id-check'),
    });
    expect(typeof admitted.receipt_id).toBe('string');
    expect(admitted.receipt_id.length).toBeGreaterThan(0);

    warnSpy.mockRestore();
  });

  it('budget/proof denial logic unchanged (same XP check, same error messages)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Proof denial — same warn message
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
    });
    expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Missing constituency proof; SentimentSignal not emitted');

    // Budget denial — same warn message
    mockCanPerformAction.mockReturnValue({ allowed: false, reason: 'Budget exhausted' });
    useSentimentState.getState().setAgreement({
      topicId: TOPIC,
      pointId: POINT,
      analysisId: ANALYSIS,
      desired: 1,
      constituency_proof: proofFor('budget-unchanged'),
    });
    expect(warnSpy).toHaveBeenCalledWith('[vh:sentiment] Budget denied:', 'Budget exhausted');

    warnSpy.mockRestore();
  });
});
