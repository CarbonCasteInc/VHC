import { describe, expect, it } from 'vitest';
import {
  buildEventTuple,
  classifyDocumentType,
  documentTypeWeight,
  extractEntities,
  extractLocations,
  extractTemporalMs,
  extractTrigger,
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
    expect(classifyDocumentType('Explainer: What we know', undefined, 'Desk')).toBe('explainer_recap');
    expect(classifyDocumentType('Trump news at a glance: latest updates', undefined, 'Desk')).toBe('explainer_recap');
    expect(classifyDocumentType('Breaking: Port attack', undefined, 'Desk')).toBe('breaking_update');
    expect(classifyDocumentType('Port attack expands', undefined, 'Reuters')).toBe('wire_report');
    expect(classifyDocumentType('Port attack expands', undefined, 'Desk')).toBe('hard_news');
    expect(refineDocumentType('hard_news', 'Trump news at a glance: latest updates', undefined, 'Desk')).toBe('explainer_recap');
    expect(refineDocumentType('wire_report', 'Live updates: storm response', undefined, 'Desk')).toBe('liveblog');
    expect(refineDocumentType(
      'hard_news',
      'Armed Iranian opposition group says its camp was hit with drone strike',
      undefined,
      'CBS News',
      'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
    )).toBe('video_clip');
    expect(refineDocumentType('hard_news', 'Port attack expands', undefined, 'Reuters')).toBe('hard_news');

    expect(documentTypeWeight('wire_report')).toBe(1.15);
    expect(documentTypeWeight('hard_news')).toBe(1);
    expect(documentTypeWeight('video_clip')).toBeLessThan(documentTypeWeight('explainer_recap'));
    expect(documentTypeWeight('liveblog')).toBe(0.85);
    expect(documentTypeWeight('explainer_recap')).toBe(0.55);
    expect(documentTypeWeight('breaking_update')).toBeGreaterThan(documentTypeWeight('hard_news'));
    expect(documentTypeWeight('opinion')).toBeLessThan(documentTypeWeight('analysis'));
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
