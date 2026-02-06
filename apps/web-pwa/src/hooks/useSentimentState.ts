import { create } from 'zustand';
import type { SentimentSignal, ConstituencyProof } from '@vh/types';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

type Agreement = -1 | 0 | 1;

interface SentimentStore {
  agreements: Record<string, Agreement>;
  lightbulb: Record<string, number>;
  eye: Record<string, number>;
  signals: SentimentSignal[];
  setAgreement: (params: {
    topicId: string;
    pointId: string;
    analysisId: string;
    desired: Agreement;
    constituency_proof?: ConstituencyProof;
  }) => void;
  recordRead: (topicId: string) => number;
  /** Generic engagement tracker (for forum votes/comments) - increments lightbulb weight with decay */
  recordEngagement: (topicId: string) => number;
  getAgreement: (topicId: string, pointId: string) => Agreement;
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

function topicActiveCount(agreements: Record<string, number>, topicId: string): number {
  const prefix = `${topicId}:`;
  return Object.keys(agreements).filter((key) => key.startsWith(prefix) && agreements[key] !== 0).length;
}

function weightForActiveCount(count: number): number {
  let weight = 0;
  for (let i = 0; i < count; i += 1) {
    weight = i === 0 ? 1 : decayStep(weight);
  }
  return weight;
}

export const useSentimentState = create<SentimentStore>((set, get) => ({
  agreements: loadMap(AGREEMENTS_KEY) as Record<string, Agreement>,
  lightbulb: loadMap(LIGHTBULB_KEY),
  eye: loadMap(EYE_KEY),
  signals: [],
  setAgreement({ topicId, pointId, analysisId, desired, constituency_proof }) {
    if (!constituency_proof) {
      console.warn('[vh:sentiment] Missing constituency proof; SentimentSignal not emitted');
      return;
    }
    const key = `${topicId}:${pointId}`;
    set((state) => {
      const currentAgreement = state.agreements[key] ?? 0;
      const nextAgreement: Agreement = currentAgreement === desired ? 0 : desired;

      const nextAgreements = { ...state.agreements, [key]: nextAgreement };

      const activeCount = topicActiveCount(nextAgreements, topicId);
      const nextWeight = weightForActiveCount(activeCount);
      const nextLightbulb = { ...state.lightbulb, [topicId]: nextWeight };

      const signal: SentimentSignal = {
        topic_id: topicId,
        analysis_id: analysisId,
        point_id: pointId,
        agreement: nextAgreement,
        weight: nextWeight,
        constituency_proof,
        emitted_at: Date.now()
      };

      persistMap(AGREEMENTS_KEY, nextAgreements);
      persistMap(LIGHTBULB_KEY, nextLightbulb);

      const nextSignals = [...state.signals, signal].slice(-50);

      return {
        agreements: nextAgreements,
        lightbulb: nextLightbulb,
        signals: nextSignals
      };
    });
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
  getAgreement(topicId, pointId) {
    return get().agreements[`${topicId}:${pointId}`] ?? 0;
  },
  getLightbulbWeight(topicId) {
    return get().lightbulb[topicId] ?? 0;
  },
  getEyeWeight(topicId) {
    return get().eye[topicId] ?? 0;
  }
}));
