import { describe, expect, it } from 'vitest';
import {
  tokenize,
  extractKeywords,
  extractLocations,
  detectActionCategory,
  jaccardSimilarity,
  computeMergeSignals,
  shouldMerge,
  explainMerge,
  SAME_EVENT_MERGE_THRESHOLD,
} from '../sameEventMerge';

describe('sameEventMerge', () => {
  // --- tokenize ---
  describe('tokenize', () => {
    it('lowercases and splits on whitespace', () => {
      expect(tokenize('Biden Signs Bill')).toEqual(['biden', 'signs', 'bill']);
    });

    it('filters tokens shorter than 3 chars', () => {
      expect(tokenize('A is on it')).toEqual([]);
    });

    it('removes stop words', () => {
      const result = tokenize('The president said the bill was passed');
      expect(result).not.toContain('the');
      expect(result).not.toContain('was');
      expect(result).toContain('president');
      expect(result).toContain('bill');
      expect(result).toContain('passed');
    });

    it('strips punctuation', () => {
      expect(tokenize("Biden's plan: $100B")).toContain("biden's");
      expect(tokenize("Biden's plan: $100B")).toContain('plan');
    });

    it('returns empty for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });
  });

  // --- extractKeywords ---
  describe('extractKeywords', () => {
    it('deduplicates tokens', () => {
      const result = extractKeywords('markets rally markets surge');
      const marketCount = result.filter((t) => t === 'markets').length;
      expect(marketCount).toBe(1);
    });

    it('returns unique set from title', () => {
      const result = extractKeywords('Biden signs trade deal with China');
      expect(result).toContain('biden');
      expect(result).toContain('signs');
      expect(result).toContain('trade');
      expect(result).toContain('deal');
      expect(result).toContain('china');
    });
  });

  // --- detectActionCategory ---
  describe('detectActionCategory', () => {
    it('detects legal category', () => {
      expect(detectActionCategory('CEO arrested for fraud')).toBe('legal');
    });

    it('detects health category', () => {
      expect(detectActionCategory('President hospitalized after fall')).toBe('health');
    });

    it('detects economic category', () => {
      expect(detectActionCategory('Markets surged to record high')).toBe('economic');
    });

    it('detects conflict category', () => {
      expect(detectActionCategory('Rebels attacked border post')).toBe('conflict');
    });

    it('detects political category', () => {
      expect(detectActionCategory('Governor signed new education bill')).toBe('political');
    });

    it('detects diplomacy category', () => {
      expect(detectActionCategory('Leaders met at UN summit')).toBe('diplomacy');
    });

    it('detects disaster category', () => {
      expect(detectActionCategory('Major earthquake hits region')).toBe('disaster');
    });

    it('returns null for unrecognized verbs', () => {
      expect(detectActionCategory('Weather forecast for tomorrow')).toBeNull();
    });
  });

  // --- extractLocations ---
  describe('extractLocations', () => {
    it('extracts known location tokens', () => {
      expect(extractLocations('Major earthquake hits Japan near Tokyo')).toEqual(
        expect.arrayContaining(['japan', 'tokyo']),
      );
    });

    it('returns empty for no locations', () => {
      expect(extractLocations('Markets rally after earnings report')).toEqual([]);
    });

    it('deduplicates location tokens', () => {
      const locs = extractLocations('Japan Japan Japan earthquake');
      expect(locs.filter((l) => l === 'japan')).toHaveLength(1);
    });
  });

  // --- jaccardSimilarity ---
  describe('jaccardSimilarity', () => {
    it('returns 1 for identical sets', () => {
      expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
    });

    it('returns 0 for disjoint sets', () => {
      expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
    });

    it('returns correct ratio for partial overlap', () => {
      // {a,b} ∩ {b,c} = {b}, union = {a,b,c} → 1/3
      expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    });

    it('returns 0 for two empty arrays', () => {
      expect(jaccardSimilarity([], [])).toBe(0);
    });

    it('returns 0 when one set is empty', () => {
      expect(jaccardSimilarity(['a'], [])).toBe(0);
    });
  });

  // --- FALSE MERGE GUARDS ---
  // Same entities, different events → must NOT merge
  describe('false merge guards', () => {
    it('blocks merge: Biden trade deal vs Biden health update', () => {
      const clusterEntities = ['biden', 'trade'];
      const clusterTitles = ['Biden signs major trade deal with EU'];
      const itemEntities = ['biden', 'health'];
      const itemTitle = 'Biden hospitalized after experiencing dizziness';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(false);
      const explanation = explainMerge(clusterEntities, clusterTitles, itemEntities, itemTitle);
      expect(explanation.merged).toBe(false);
      expect(explanation.actionConflict).toBe(true);
      expect(explanation.reason).toBe('action_conflict_veto');
    });

    it('blocks merge: CEO arrested vs CEO quarterly results', () => {
      const clusterEntities = ['tesla', 'ceo'];
      const clusterTitles = ['Tesla CEO arrested on fraud charges'];
      const itemEntities = ['tesla', 'ceo'];
      const itemTitle = 'Tesla CEO announces record quarterly earnings surge';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(false);
    });

    it('blocks merge: earthquake in Japan vs trade talks in Japan', () => {
      const clusterEntities = ['japan', 'earthquake'];
      const clusterTitles = ['Major earthquake hits Japan causing widespread damage'];
      const itemEntities = ['japan', 'trade'];
      const itemTitle = 'Japan signs new trade agreement with Australia';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(false);
    });

    it('blocks merge: same person, conflict vs diplomacy', () => {
      const clusterEntities = ['putin', 'ukraine'];
      const clusterTitles = ['Russia attacked Ukrainian positions overnight'];
      const itemEntities = ['putin', 'ukraine'];
      const itemTitle = 'Putin and Zelensky agreed to ceasefire terms';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(false);
    });

    it('penalizes location mismatch in scoring', () => {
      const signals = computeMergeSignals(
        ['earthquake', 'damage'],
        ['Major earthquake hits Japan causing damage'],
        ['earthquake', 'damage'],
        'Earthquake strikes Mexico causing widespread damage',
      );
      // Different locations → locationAlignment = 0
      expect(signals.locationAlignment).toBe(0);
    });

    it('blocks merge: no entity overlap at all', () => {
      const result = shouldMerge(['apple'], ['Apple launches new iPhone'], ['microsoft'], 'Microsoft releases Windows update');
      expect(result).toBe(false);
      const explanation = explainMerge(['apple'], ['Apple launches new iPhone'], ['microsoft'], 'Microsoft releases Windows update');
      expect(explanation.reason).toBe('no_entity_overlap');
    });
  });

  // --- FALSE SPLIT GUARDS ---
  // Same event, varied wording → should merge
  describe('false split guards', () => {
    it('merges: same trade deal, different wording', () => {
      const clusterEntities = ['biden', 'trade', 'china'];
      const clusterTitles = ['Biden signs historic trade deal with China'];
      const itemEntities = ['biden', 'trade', 'china'];
      const itemTitle = 'US and China reach trade agreement under Biden';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(true);
    });

    it('merges: same earthquake, different outlets', () => {
      const clusterEntities = ['japan', 'earthquake', 'tokyo'];
      const clusterTitles = ['Major earthquake strikes near Tokyo, Japan'];
      const itemEntities = ['japan', 'earthquake', 'tokyo'];
      const itemTitle = 'Earthquake rocks Tokyo region, tsunami warning issued';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(true);
    });

    it('merges: same arrest, different framing', () => {
      const clusterEntities = ['senator', 'smith', 'corruption'];
      const clusterTitles = ['Senator Smith arrested on corruption charges'];
      const itemEntities = ['senator', 'smith', 'corruption'];
      const itemTitle = 'Federal agents charged Senator Smith with corruption';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(true);
    });

    it('merges: same market event, headline variation', () => {
      const clusterEntities = ['markets', 'dow', 'fed'];
      const clusterTitles = ['Markets surged after Fed rate decision'];
      const itemEntities = ['markets', 'dow', 'fed'];
      const itemTitle = 'Dow rallied sharply following Federal Reserve announcement';

      expect(shouldMerge(clusterEntities, clusterTitles, itemEntities, itemTitle)).toBe(true);
    });
  });

  // --- computeMergeSignals ---
  describe('computeMergeSignals', () => {
    it('returns all signal fields', () => {
      const signals = computeMergeSignals(
        ['biden', 'trade'],
        ['Biden signs trade deal'],
        ['biden', 'trade'],
        'Biden trade agreement finalized',
      );
      expect(signals).toHaveProperty('entityOverlap');
      expect(signals).toHaveProperty('keywordOverlap');
      expect(signals).toHaveProperty('actionMatch');
      expect(signals).toHaveProperty('actionConflict');
      expect(signals).toHaveProperty('locationAlignment');
      expect(signals).toHaveProperty('score');
      expect(signals.entityOverlap).toBeGreaterThan(0);
      expect(signals.score).toBeGreaterThan(0);
    });

    it('scores 0.5 for action when neither has a recognized verb', () => {
      const signals = computeMergeSignals(
        ['test'], ['Generic headline about test'],
        ['test'], 'Another generic headline about test',
      );
      // actionScore = 0.5 (neutral) when no verbs detected
      expect(signals.actionMatch).toBe(false);
      expect(signals.actionConflict).toBe(false);
    });
  });

  // --- explainMerge ---
  describe('explainMerge', () => {
    it('provides full explanation for a merge', () => {
      const explanation = explainMerge(
        ['biden', 'trade'],
        ['Biden signs trade deal'],
        ['biden', 'trade'],
        'Biden trade deal signed into law',
      );
      expect(explanation.merged).toBe(true);
      expect(explanation.reason).toBe('same_event_match');
      expect(explanation.compositeScore).toBeGreaterThanOrEqual(SAME_EVENT_MERGE_THRESHOLD);
      expect(explanation.actionCategory).toBe('political');
      expect(explanation.locationAlignment).toBeDefined();
    });

    it('explains below-threshold rejection', () => {
      // 1 shared entity out of many = low entity Jaccard.
      // Completely disjoint keywords = low keyword Jaccard.
      // No action verbs = neutral action (0.5).
      // Score ≈ 0.25*low + 0.35*0 + 0.25*0.5 + 0.15*1 = well below threshold.
      const explanation = explainMerge(
        ['shared-ent', 'ent-b', 'ent-c', 'ent-d', 'ent-e', 'ent-f'],
        ['Abcdef ghijkl mnopqr stuvwx yzabcd efghij'],
        ['shared-ent', 'ent-x', 'ent-y', 'ent-z', 'ent-w', 'ent-v'],
        'Klmnop qrstuv wxyzab cdefgh ijklmn opqrst',
      );
      expect(explanation.merged).toBe(false);
      expect(explanation.reason).toBe('below_threshold');
      expect(explanation.entityOverlap).toBeGreaterThan(0);
      expect(explanation.compositeScore).toBeLessThan(SAME_EVENT_MERGE_THRESHOLD);
    });
  });

  // --- SAME_EVENT_MERGE_THRESHOLD ---
  describe('threshold constant', () => {
    it('is a reasonable value between 0 and 1', () => {
      expect(SAME_EVENT_MERGE_THRESHOLD).toBeGreaterThan(0);
      expect(SAME_EVENT_MERGE_THRESHOLD).toBeLessThan(1);
    });
  });
});
