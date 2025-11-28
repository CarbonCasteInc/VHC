/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import { useSentimentState } from './useSentimentState';

const TOPIC = 't1';
const POINT = 'p1';
const ANALYSIS = 'a1';

describe('useSentimentState', () => {
  beforeEach(() => {
    localStorage.clear();
    useSentimentState.setState({
      agreements: {},
      lightbulb: {},
      eye: {},
      signals: [],
      setAgreement: useSentimentState.getState().setAgreement,
      recordRead: useSentimentState.getState().recordRead,
      getAgreement: useSentimentState.getState().getAgreement,
      getLightbulbWeight: useSentimentState.getState().getLightbulbWeight,
      getEyeWeight: useSentimentState.getState().getEyeWeight
    });
  });

  it('cycles agreement and emits signals', () => {
    const proof = { district_hash: 'd', nullifier: 'n', merkle_root: 'm' };
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
});
