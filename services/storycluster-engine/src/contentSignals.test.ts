import { describe, expect, it } from 'vitest';
import {
  buildEventTuple,
  classifyDocumentType,
  documentTypeWeight,
  extractEntities,
  extractLocations,
  extractTemporalMs,
  extractTrigger,
  isRelatedCoverageText,
  normalizeDocumentType,
  refineDocumentType,
  resolveLanguage,
  shouldTranslate,
  translateLexicon,
  triggerCategory,
} from './contentSignals';

describe('contentSignals', () => {
  it('resolves language from hints and lexical detection', () => {
    expect(resolveLanguage('ignored text', 'fr')).toBe('fr');
    expect(
      resolveLanguage('El gobierno confirmó nuevas sanciones y el mercado reaccionó con fuerza durante la noche.', undefined),
    ).toBe('es');
    expect(resolveLanguage('short text', undefined)).toBe('en');
  });

  it('gates and applies lexicon translation', () => {
    expect(shouldTranslate('en', 'plain english text')).toBe(false);
    expect(shouldTranslate('es', 'El gobierno confirmó nuevas sanciones para el mercado esta noche')).toBe(true);
    expect(translateLexicon('ataque mercado crisis', 'es')).toEqual({ text: 'attack market crisis', applied: true });
    expect(translateLexicon('attaque marche crise', 'fr')).toEqual({ text: 'attack market crisis', applied: true });
    expect(translateLexicon('kein worterbuch', 'de')).toEqual({ text: 'kein worterbuch', applied: false });
    expect(translateLexicon('!!!', 'es')).toEqual({ text: '!!!', applied: false });
  });

  it('classifies document types and weights', () => {
    expect(classifyDocumentType(
      'Armed Iranian opposition group says its camp was hit with drone strike',
      undefined,
      'CBS News',
      'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
    )).toBe('video_clip');
    expect(classifyDocumentType('Live updates: storm response', undefined, 'Desk')).toBe('liveblog');
    expect(classifyDocumentType('Opinion: Why this matters', undefined, 'Desk')).toBe('opinion');
    expect(classifyDocumentType('Analysis: Market fallout', undefined, 'Desk')).toBe('analysis');
    expect(classifyDocumentType(
      'Why the port strike is becoming a test of industrial policy',
      'Commentary on what the Atlantic port strike means for industrial policy and labour politics.',
      'Desk',
    )).toBe('analysis');
    expect(classifyDocumentType('Explainer: What we know', undefined, 'Desk')).toBe('explainer');
    expect(classifyDocumentType('Trump news at a glance: latest updates', undefined, 'Desk')).toBe('explainer');
    expect(classifyDocumentType('Breaking: Port attack', undefined, 'Desk')).toBe('breaking_update');
    expect(classifyDocumentType('Port attack expands', undefined, 'Reuters')).toBe('wire');
    expect(classifyDocumentType('Port attack expands', undefined, 'Desk')).toBe('hard_news');
    expect(refineDocumentType('hard_news', 'Trump news at a glance: latest updates', undefined, 'Desk')).toBe('explainer');
    expect(refineDocumentType('wire', 'Live updates: storm response', undefined, 'Desk')).toBe('liveblog');
    expect(refineDocumentType(
      'hard_news',
      'Armed Iranian opposition group says its camp was hit with drone strike',
      undefined,
      'CBS News',
      'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
    )).toBe('video_clip');
    expect(refineDocumentType('hard_news', 'Port attack expands', undefined, 'Reuters')).toBe('hard_news');
    expect(refineDocumentType(
      'hard_news',
      'Why the port strike is becoming a test of industrial policy',
      'Commentary on what the Atlantic port strike means for industrial policy and labour politics.',
      'Desk',
    )).toBe('analysis');

    expect(documentTypeWeight('wire')).toBe(1.15);
    expect(documentTypeWeight('hard_news')).toBe(1);
    expect(documentTypeWeight('video_clip')).toBeLessThan(documentTypeWeight('explainer'));
    expect(documentTypeWeight('liveblog')).toBe(0.85);
    expect(documentTypeWeight('explainer')).toBe(0.55);
    expect(documentTypeWeight('breaking_update')).toBeGreaterThan(documentTypeWeight('hard_news'));
    expect(documentTypeWeight('opinion')).toBeLessThan(documentTypeWeight('analysis'));
  });

  it('normalizes historical document type aliases to canonical values', () => {
    expect(normalizeDocumentType('wire_report')).toBe('wire');
    expect(normalizeDocumentType('explainer_recap')).toBe('explainer');
    expect(normalizeDocumentType('wire')).toBe('wire');
    expect(normalizeDocumentType(' explainer ')).toBe('explainer');
    expect(normalizeDocumentType('mystery_type')).toBe('hard_news');
    expect(normalizeDocumentType(null)).toBe('hard_news');
  });

  it('treats related-coverage text consistently with and without summaries', () => {
    expect(isRelatedCoverageText('Explainer: What we know', undefined, 'Desk')).toBe(true);
    expect(isRelatedCoverageText('Straight update', 'Opinion: this matters', 'Desk')).toBe(true);
    expect(isRelatedCoverageText(
      'Why the port strike is becoming a test of industrial policy',
      'Commentary on what the Atlantic port strike means for industrial policy and labour politics.',
      'Desk',
    )).toBe(true);
    expect(isRelatedCoverageText('Straight update', 'Plain summary', 'Desk')).toBe(false);
  });

  it('extracts entities, locations, triggers, and temporal anchors', () => {
    const text = 'Tehran officials said the Port Authority in New York would resume talks on March 4, 2026 after the attack.';
    expect(extractEntities(text, ['port_authority'])).toContain('port_authority');
    expect(extractLocations(text)).toEqual(expect.arrayContaining(['tehran', 'new_york']));
    expect(extractTrigger(text)).toBe('attack');
    expect(triggerCategory('attack')).toBe('conflict');
    expect(triggerCategory('detain')).toBe('legal');
    expect(triggerCategory('schedules')).toBe('politics');
    expect(triggerCategory('unknown')).toBeNull();
    expect(triggerCategory(null)).toBeNull();
    expect(extractTemporalMs(text, Date.UTC(2026, 2, 5))).toBeTypeOf('number');
    expect(extractTemporalMs('   ', Date.UTC(2026, 2, 5))).toBeNull();
    expect(extractTemporalMs('Police detain protest leaders after the capital march turns violent.', Date.UTC(2026, 2, 5))).toBeNull();
    expect(extractTemporalMs('Parliament schedules a ceasefire vote after the weekend attacks.', Date.UTC(2026, 2, 5))).toBeNull();
    expect(extractTemporalMs('Officials say voting continues today.', Date.UTC(2026, 2, 5))).toBeTypeOf('number');
    expect(extractEntities('a an the', [])).toEqual([]);
  });

  it('prefers lead-clause triggers over background conflict context', () => {
    expect(
      extractTrigger('Ambulances rerouted after ransomware attack hits metro hospital system'),
    ).toBe('ransomware');
    expect(
      extractTrigger('Cyber attack forces city hospital network offline'),
    ).toBe('cyberattack');
    expect(
      extractTrigger('Trump tells Starmer help not needed even as US uses UK bases for Iran strikes'),
    ).toBe('tells');
    expect(
      extractTrigger("Trump doesn't rule out sending American troops to Iran"),
    ).toBe('troops');
    expect(
      extractTrigger('Trump tells Starmer Britain need not join Iran campaign as US uses UK bases'),
    ).toBe('tells');
    expect(
      extractTrigger('Osaka hospitals run a citywide earthquake drill'),
    ).toBe('drill');
    expect(
      extractTrigger('Osaka officials review the regional earthquake exercise'),
    ).toBe('exercise');
    expect(triggerCategory('tells')).toBe('diplomacy');
    expect(triggerCategory('troops')).toBe('military_posture');
    expect(triggerCategory('drill')).toBe('preparedness');
    expect(triggerCategory('ransomware')).toBe('infrastructure_disruption');
    expect(triggerCategory('cyberattack')).toBe('infrastructure_disruption');
  });

  it('normalizes infrastructure-disruption and legal-verdict trigger families', () => {
    expect(triggerCategory('forced')).toBe('infrastructure_disruption');
    expect(triggerCategory('rerouted')).toBe('infrastructure_disruption');
    expect(triggerCategory('continued')).toBe('infrastructure_disruption');
    expect(triggerCategory('left')).toBe('infrastructure_disruption');
    expect(triggerCategory('convicted')).toBe('legal_verdict');
    expect(triggerCategory('guilty')).toBe('legal_verdict');
    expect(triggerCategory('found')).toBe('legal_verdict');
  });

  it('returns no trigger candidates for empty normalized text', () => {
    expect(extractTrigger('   ')).toBeNull();
  });

  it('builds event tuples', () => {
    const tuple = buildEventTuple(
      'Port attack disrupts terminals overnight',
      'Officials say recovery talks begin Friday.',
      ['port_authority', 'officials'],
      ['tehran'],
      Date.UTC(2026, 2, 5),
    );
    expect(tuple.description).toContain('Port attack');
    expect(tuple.trigger).toBe('attack');
    expect(tuple.who).toEqual(['Port Authority', 'Officials']);
    expect(tuple.where).toEqual(['Tehran']);
    expect(tuple.outcome).toBe('Officials say recovery talks begin Friday.');

    const noSummaryTuple = buildEventTuple('Quiet update', undefined, [], [], Date.UTC(2026, 2, 5));
    expect(noSummaryTuple.outcome).toBeNull();
  });
});
