import { create } from 'zustand';
import type { SentimentSignal, ConstituencyProof } from '@vh/types';
import { deriveAggregateVoterId } from '@vh/data-model';
import { writeSentimentEvent, writeVoterNode } from '@vh/gun-client';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { useXpLedger } from '../store/xpLedger';
import { legacyWeightForActiveCount, resolveNextAgreement, type Agreement } from '../components/feed/voteSemantics';

interface SentimentStore {
  agreements: Record<string, Agreement>;
  lightbulb: Record<string, number>;
  eye: Record<string, number>;
  signals: SentimentSignal[];
  setAgreement: (params: {
    topicId: string;
    pointId: string;
    synthesisId?: string;
    epoch?: number;
    desired: Agreement;
    constituency_proof?: ConstituencyProof;
    analysisId?: string;
  }) => { denied: true; reason: string } | void;
  recordRead: (topicId: string) => number;
  /** Generic engagement tracker (for forum votes/comments) - increments lightbulb weight with decay */
  recordEngagement: (topicId: string) => number;
  getAgreement: (topicId: string, pointId: string, synthesisId?: string, epoch?: number) => Agreement;
  getLightbulbWeight: (topicId: string) => number;
  getEyeWeight: (topicId: string) => number;
}

const AGREEMENTS_KEY = 'vh_sentiment_agreements_v1';
const LIGHTBULB_KEY = 'vh_lightbulb_weights_v1';
const EYE_KEY = 'vh_eye_weights_v1';

function loadMap(key: string): Record<string, number> {
  try {
    const raw = safeGetItem(key);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function persistMap(key: string, value: Record<string, number>) {
  try {
    safeSetItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function clampWeight(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 2) return 2;
  return value;
}

function decayStep(current: number): number {
  return clampWeight(current + 0.3 * (2.0 - current));
}

function normalizeSynthesisId(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEpoch(value?: number): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function resolveSentimentContext(params: {
  synthesisId?: string;
  epoch?: number;
  analysisId?: string;
}): { synthesisId: string; epoch: number } | null {
  const explicitSynthesisId = normalizeSynthesisId(params.synthesisId);
  const explicitEpoch = normalizeEpoch(params.epoch);
  if (explicitSynthesisId !== null && explicitEpoch !== null) {
    return { synthesisId: explicitSynthesisId, epoch: explicitEpoch };
  }

  const legacySynthesisId = normalizeSynthesisId(params.analysisId);
  if (legacySynthesisId !== null) {
    return {
      synthesisId: legacySynthesisId,
      epoch: explicitEpoch ?? 0,
    };
  }

  return null;
}

function contextPrefix(topicId: string, synthesisId: string, epoch: number): string {
  return `${topicId}:${synthesisId}:${epoch}:`;
}

function buildAgreementKey(topicId: string, synthesisId: string, epoch: number, pointId: string): string {
  return `${contextPrefix(topicId, synthesisId, epoch)}${pointId}`;
}

function buildLegacyAgreementKey(topicId: string, pointId: string): string {
  return `${topicId}:${pointId}`;
}

function contextActiveCount(agreements: Record<string, number>, prefix: string): number {
  return Object.keys(agreements).filter((key) => key.startsWith(prefix) && agreements[key] !== 0).length;
}

function readAgreementValue(
  agreements: Record<string, Agreement>,
  topicId: string,
  pointId: string,
  synthesisId?: string,
  epoch?: number,
): Agreement {
  const resolvedContext = resolveSentimentContext({
    synthesisId,
    epoch,
  });

  if (resolvedContext) {
    const contextualKey = buildAgreementKey(
      topicId,
      resolvedContext.synthesisId,
      resolvedContext.epoch,
      pointId,
    );
    if (contextualKey in agreements) {
      return agreements[contextualKey] ?? 0;
    }
  }

  const legacyKey = buildLegacyAgreementKey(topicId, pointId);
  if (legacyKey in agreements) {
    return agreements[legacyKey] ?? 0;
  }

  const contextualPrefix = `${topicId}:`;
  for (const [key, value] of Object.entries(agreements)) {
    if (!key.startsWith(contextualPrefix)) {
      continue;
    }

    if (key.endsWith(`:${pointId}`)) {
      return value ?? 0;
    }
  }

  return 0;
}

function asIsoTimestamp(emittedAt: number): string {
  return new Date(emittedAt).toISOString();
}

async function projectSignalToMesh(signal: SentimentSignal): Promise<void> {
  const client = resolveClientFromAppStore();
  if (!client) {
    return;
  }

  const hasSentimentTransports =
    typeof (client as { gun?: { user?: unknown } }).gun?.user === 'function' &&
    typeof (client as { mesh?: { get?: unknown } }).mesh?.get === 'function';
  if (!hasSentimentTransports) {
    return;
  }

  try {
    await writeSentimentEvent(client, {
      topic_id: signal.topic_id,
      synthesis_id: signal.synthesis_id,
      epoch: signal.epoch,
      point_id: signal.point_id,
      agreement: signal.agreement,
      weight: signal.weight,
      constituency_proof: signal.constituency_proof,
      emitted_at: signal.emitted_at,
    });
  } catch (error) {
    console.warn('[vh:sentiment] Failed to write encrypted sentiment event:', error);
  }

  try {
    const voterId = await deriveAggregateVoterId({
      nullifier: signal.constituency_proof.nullifier,
      topic_id: signal.topic_id,
    });

    await writeVoterNode(client, signal.topic_id, signal.synthesis_id, signal.epoch, voterId, {
      point_id: signal.point_id,
      agreement: signal.agreement,
      weight: signal.weight,
      updated_at: asIsoTimestamp(signal.emitted_at),
    });
  } catch (error) {
    console.warn('[vh:sentiment] Failed to project aggregate voter node:', error);
  }
}

export const useSentimentState = create<SentimentStore>((set, get) => ({
  agreements: loadMap(AGREEMENTS_KEY) as Record<string, Agreement>,
  lightbulb: loadMap(LIGHTBULB_KEY),
  eye: loadMap(EYE_KEY),
  signals: [],
  setAgreement({ topicId, pointId, synthesisId, epoch, desired, constituency_proof, analysisId }) {
    if (!constituency_proof) {
      console.warn('[vh:sentiment] Missing constituency proof; SentimentSignal not emitted');
      return { denied: true, reason: 'Missing constituency proof' };
    }

    const context = resolveSentimentContext({ synthesisId, epoch, analysisId });
    if (!context) {
      console.warn('[vh:sentiment] Missing synthesis context; SentimentSignal not emitted');
      return { denied: true, reason: 'Missing synthesis context' };
    }

    const normalizedSynthesisId = context.synthesisId;
    const normalizedEpoch = context.epoch;

    // intentional: must activate nullifier before checking its budget
    useXpLedger.getState().setActiveNullifier(constituency_proof.nullifier);
    // no per-topic sub-cap for sentiment votes
    const budgetCheck = useXpLedger.getState().canPerformAction('sentiment_votes/day', 1);
    if (!budgetCheck.allowed) {
      const reason = budgetCheck.reason || 'Daily limit reached for sentiment_votes/day';
      console.warn('[vh:sentiment] Budget denied:', reason);
      return { denied: true, reason };
    }

    const key = buildAgreementKey(topicId, normalizedSynthesisId, normalizedEpoch, pointId);
    const legacyKey = buildLegacyAgreementKey(topicId, pointId);
    const prefix = contextPrefix(topicId, normalizedSynthesisId, normalizedEpoch);
    let emittedSignal: SentimentSignal | null = null;

    set((state) => {
      const currentAgreement = readAgreementValue(
        state.agreements,
        topicId,
        pointId,
        normalizedSynthesisId,
        normalizedEpoch,
      );
      const nextAgreement = desired === 0
        ? 0
        : resolveNextAgreement(currentAgreement, desired);

      const nextAgreements: Record<string, Agreement> = { ...state.agreements, [key]: nextAgreement };
      if (legacyKey !== key) {
        delete nextAgreements[legacyKey];
      }

      const activeCount = contextActiveCount(nextAgreements, prefix);
      const nextWeight = legacyWeightForActiveCount(activeCount);
      const nextLightbulb = { ...state.lightbulb, [topicId]: nextWeight };

      const signal: SentimentSignal = {
        topic_id: topicId,
        synthesis_id: normalizedSynthesisId,
        epoch: normalizedEpoch,
        analysis_id: analysisId,
        point_id: pointId,
        agreement: nextAgreement,
        weight: nextWeight,
        constituency_proof,
        emitted_at: Date.now()
      };
      emittedSignal = signal;

      persistMap(AGREEMENTS_KEY, nextAgreements);
      persistMap(LIGHTBULB_KEY, nextLightbulb);

      const nextSignals = [...state.signals, signal].slice(-50);

      return {
        agreements: nextAgreements,
        lightbulb: nextLightbulb,
        signals: nextSignals
      };
    });

    useXpLedger.getState().consumeAction('sentiment_votes/day', 1);
    if (emittedSignal) {
      void projectSignalToMesh(emittedSignal);
    }
  },
  recordRead(topicId) {
    const current = get().eye[topicId] ?? 0;
    const next = current === 0 ? 1 : decayStep(current);
    const eye = { ...get().eye, [topicId]: next };
    persistMap(EYE_KEY, eye);
    set({ eye });
    return next;
  },
  recordEngagement(topicId) {
    const current = get().lightbulb[topicId] ?? 0;
    const next = current === 0 ? 1 : decayStep(current);
    const lightbulb = { ...get().lightbulb, [topicId]: next };
    persistMap(LIGHTBULB_KEY, lightbulb);
    set({ lightbulb });
    return next;
  },
  getAgreement(topicId, pointId, synthesisId, epoch) {
    return readAgreementValue(get().agreements, topicId, pointId, synthesisId, epoch);
  },
  getLightbulbWeight(topicId) {
    return get().lightbulb[topicId] ?? 0;
  },
  getEyeWeight(topicId) {
    return get().eye[topicId] ?? 0;
  }
}));
