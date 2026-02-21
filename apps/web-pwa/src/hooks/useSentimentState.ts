import { create } from 'zustand';
import type { SentimentSignal, ConstituencyProof } from '@vh/types';
import { deriveAggregateVoterId } from '@vh/data-model';
import { writeSentimentEvent, writeVoterNode } from '@vh/gun-client';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { useXpLedger } from '../store/xpLedger';
import {
  decayTowardsTopicImpactCap,
  legacyWeightForActiveCount,
  resolveNextAgreement,
  type Agreement,
} from '../components/feed/voteSemantics';
import { logMeshWriteResult, logVoteAdmission } from '../utils/sentimentTelemetry';

interface SentimentStore {
  agreements: Record<string, Agreement>;
  pointIdAliases: Record<string, string>;
  lightbulb: Record<string, number>;
  eye: Record<string, number>;
  signals: SentimentSignal[];
  setAgreement: (params: {
    topicId: string;
    pointId: string;
    synthesisPointId?: string;
    synthesisId?: string;
    epoch?: number;
    desired: Agreement;
    constituency_proof?: ConstituencyProof;
    analysisId?: string;
  }) => { denied: true; reason: string } | void;
  recordRead: (topicId: string) => number;
  /** Generic engagement tracker (for forum votes/comments) - increments lightbulb weight with decay */
  recordEngagement: (topicId: string) => number;
  getAgreement: (
    topicId: string,
    pointId: string,
    synthesisId?: string,
    epoch?: number,
    legacyPointId?: string,
  ) => Agreement;
  getLightbulbWeight: (topicId: string) => number;
  getEyeWeight: (topicId: string) => number;
}

const AGREEMENTS_KEY = 'vh_sentiment_agreements_v1';
const AGREEMENT_ALIASES_KEY = 'vh_sentiment_agreement_aliases_v1';
const LIGHTBULB_KEY = 'vh_lightbulb_weights_v1';
const EYE_KEY = 'vh_eye_weights_v1';

function loadNumberMap(key: string): Record<string, number> {
  try {
    const raw = safeGetItem(key);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function loadStringMap(key: string): Record<string, string> {
  try {
    const raw = safeGetItem(key);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistNumberMap(key: string, value: Record<string, number>) {
  try {
    safeSetItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function persistStringMap(key: string, value: Record<string, string>) {
  try {
    safeSetItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// Shared decay math lives in voteSemantics.ts

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

function normalizePointId(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

function contextActiveCount(
  agreements: Record<string, number>,
  prefix: string,
  pointIdAliases: Record<string, string>,
): number {
  return Object.keys(agreements).filter((key) => {
    if (!key.startsWith(prefix) || agreements[key] === 0) {
      return false;
    }

    const canonicalKey = pointIdAliases[key];
    if (canonicalKey && canonicalKey in agreements) {
      return false;
    }

    return true;
  }).length;
}

function readAgreementValue(
  agreements: Record<string, Agreement>,
  topicId: string,
  pointId: string,
  synthesisId?: string,
  epoch?: number,
  legacyPointId?: string,
): Agreement {
  const resolvedContext = resolveSentimentContext({
    synthesisId,
    epoch,
  });

  const candidatePointIds = legacyPointId && legacyPointId !== pointId
    ? [pointId, legacyPointId]
    : [pointId];

  if (resolvedContext) {
    for (const candidatePointId of candidatePointIds) {
      const contextualKey = buildAgreementKey(
        topicId,
        resolvedContext.synthesisId,
        resolvedContext.epoch,
        candidatePointId,
      );
      if (contextualKey in agreements) {
        return agreements[contextualKey] ?? 0;
      }
    }
  }

  for (const candidatePointId of candidatePointIds) {
    const legacyKey = buildLegacyAgreementKey(topicId, candidatePointId);
    if (legacyKey in agreements) {
      return agreements[legacyKey] ?? 0;
    }
  }

  const contextualPrefix = `${topicId}:`;
  for (const [key, value] of Object.entries(agreements)) {
    if (!key.startsWith(contextualPrefix)) {
      continue;
    }

    for (const candidatePointId of candidatePointIds) {
      if (key.endsWith(`:${candidatePointId}`)) {
        return value ?? 0;
      }
    }
  }

  return 0;
}

function asIsoTimestamp(emittedAt: number): string {
  return new Date(emittedAt).toISOString();
}

async function projectSignalToMesh(signal: SentimentSignal): Promise<void> {
  const startedAt = Date.now();
  let success = true;
  let timedOut = false;
  let errorMessage: string | undefined;

  const finalize = () => {
    logMeshWriteResult({
      topic_id: signal.topic_id,
      point_id: signal.point_id,
      success,
      timed_out: timedOut,
      latency_ms: Math.max(0, Date.now() - startedAt),
      error: errorMessage,
    });
  };

  const client = resolveClientFromAppStore();
  if (!client) {
    success = false;
    errorMessage = 'client-unavailable';
    finalize();
    return;
  }

  const hasSentimentTransports =
    typeof (client as { gun?: { user?: unknown } }).gun?.user === 'function' &&
    typeof (client as { mesh?: { get?: unknown } }).mesh?.get === 'function';
  if (!hasSentimentTransports) {
    success = false;
    errorMessage = 'sentiment-transport-unavailable';
    finalize();
    return;
  }

  try {
    const eventWriteResult = await writeSentimentEvent(client, {
      topic_id: signal.topic_id,
      synthesis_id: signal.synthesis_id,
      epoch: signal.epoch,
      point_id: signal.point_id,
      agreement: signal.agreement,
      weight: signal.weight,
      constituency_proof: signal.constituency_proof,
      emitted_at: signal.emitted_at,
    });

    if (!eventWriteResult.ack.acknowledged) {
      success = false;
      timedOut = eventWriteResult.ack.timedOut;
      errorMessage = eventWriteResult.ack.timedOut
        ? 'sentiment-outbox-timeout'
        : 'sentiment-outbox-not-acknowledged';
    }
  } catch (error) {
    success = false;
    errorMessage = error instanceof Error ? error.message : String(error);
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
    success = false;
    const nextErrorMessage = error instanceof Error ? error.message : String(error);
    errorMessage = errorMessage ? `${errorMessage}; ${nextErrorMessage}` : nextErrorMessage;
    console.warn('[vh:sentiment] Failed to project aggregate voter node:', error);
  }

  finalize();
}

export const useSentimentState = create<SentimentStore>((set, get) => ({
  agreements: loadNumberMap(AGREEMENTS_KEY) as Record<string, Agreement>,
  pointIdAliases: loadStringMap(AGREEMENT_ALIASES_KEY),
  lightbulb: loadNumberMap(LIGHTBULB_KEY),
  eye: loadNumberMap(EYE_KEY),
  signals: [],
  setAgreement({ topicId, pointId, synthesisPointId, synthesisId, epoch, desired, constituency_proof, analysisId }) {
    if (!constituency_proof) {
      logVoteAdmission({
        topic_id: topicId,
        point_id: pointId,
        admitted: false,
        reason: 'Missing constituency proof',
      });
      console.warn('[vh:sentiment] Missing constituency proof; SentimentSignal not emitted');
      return { denied: true, reason: 'Missing constituency proof' };
    }

    const normalizedPointId = normalizePointId(pointId);
    if (!normalizedPointId) {
      logVoteAdmission({
        topic_id: topicId,
        point_id: pointId,
        admitted: false,
        reason: 'Missing point_id',
      });
      console.warn('[vh:sentiment] Missing point_id; SentimentSignal not emitted');
      return { denied: true, reason: 'Missing point_id' };
    }

    const normalizedSynthesisPointId = normalizePointId(synthesisPointId) ?? normalizedPointId;
    const legacyCompatPointId = normalizedSynthesisPointId !== normalizedPointId
      ? normalizedPointId
      : null;

    const context = resolveSentimentContext({ synthesisId, epoch, analysisId });
    if (!context) {
      logVoteAdmission({
        topic_id: topicId,
        point_id: normalizedSynthesisPointId,
        admitted: false,
        reason: 'Missing synthesis context',
      });
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
      logVoteAdmission({
        topic_id: topicId,
        point_id: normalizedSynthesisPointId,
        admitted: false,
        reason,
      });
      console.warn('[vh:sentiment] Budget denied:', reason);
      return { denied: true, reason };
    }

    logVoteAdmission({
      topic_id: topicId,
      point_id: normalizedSynthesisPointId,
      admitted: true,
    });

    const canonicalContextKey = buildAgreementKey(
      topicId,
      normalizedSynthesisId,
      normalizedEpoch,
      normalizedSynthesisPointId,
    );
    const compatContextKey = legacyCompatPointId
      ? buildAgreementKey(topicId, normalizedSynthesisId, normalizedEpoch, legacyCompatPointId)
      : null;
    const canonicalLegacyKey = buildLegacyAgreementKey(topicId, normalizedSynthesisPointId);
    const legacyFlatKey = buildLegacyAgreementKey(topicId, normalizedPointId);
    const prefix = contextPrefix(topicId, normalizedSynthesisId, normalizedEpoch);
    let emittedSignal: SentimentSignal | null = null;

    set((state) => {
      const currentAgreement = readAgreementValue(
        state.agreements,
        topicId,
        normalizedSynthesisPointId,
        normalizedSynthesisId,
        normalizedEpoch,
        legacyCompatPointId ?? undefined,
      );
      const nextAgreement = desired === 0
        ? 0
        : resolveNextAgreement(currentAgreement, desired);

      const nextAgreements: Record<string, Agreement> = {
        ...state.agreements,
        [canonicalContextKey]: nextAgreement,
      };
      const nextPointIdAliases: Record<string, string> = { ...state.pointIdAliases };

      if (compatContextKey) {
        nextAgreements[compatContextKey] = nextAgreement;
        nextPointIdAliases[compatContextKey] = canonicalContextKey;
      }

      delete nextAgreements[legacyFlatKey];
      delete nextAgreements[canonicalLegacyKey];

      const activeCount = contextActiveCount(nextAgreements, prefix, nextPointIdAliases);
      const nextWeight = legacyWeightForActiveCount(activeCount);
      const nextLightbulb = { ...state.lightbulb, [topicId]: nextWeight };

      const signal: SentimentSignal = {
        topic_id: topicId,
        synthesis_id: normalizedSynthesisId,
        epoch: normalizedEpoch,
        analysis_id: analysisId,
        point_id: normalizedSynthesisPointId,
        agreement: nextAgreement,
        weight: nextWeight,
        constituency_proof,
        emitted_at: Date.now()
      };
      emittedSignal = signal;

      persistNumberMap(AGREEMENTS_KEY, nextAgreements);
      persistStringMap(AGREEMENT_ALIASES_KEY, nextPointIdAliases);
      persistNumberMap(LIGHTBULB_KEY, nextLightbulb);

      const nextSignals = [...state.signals, signal].slice(-50);

      return {
        agreements: nextAgreements,
        pointIdAliases: nextPointIdAliases,
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
    const next = current === 0 ? 1 : decayTowardsTopicImpactCap(current);
    const eye = { ...get().eye, [topicId]: next };
    persistNumberMap(EYE_KEY, eye);
    set({ eye });
    return next;
  },
  recordEngagement(topicId) {
    const current = get().lightbulb[topicId] ?? 0;
    const next = current === 0 ? 1 : decayTowardsTopicImpactCap(current);
    const lightbulb = { ...get().lightbulb, [topicId]: next };
    persistNumberMap(LIGHTBULB_KEY, lightbulb);
    set({ lightbulb });
    return next;
  },
  getAgreement(topicId, pointId, synthesisId, epoch, legacyPointId) {
    return readAgreementValue(get().agreements, topicId, pointId, synthesisId, epoch, legacyPointId);
  },
  getLightbulbWeight(topicId) {
    return get().lightbulb[topicId] ?? 0;
  },
  getEyeWeight(topicId) {
    return get().eye[topicId] ?? 0;
  }
}));
