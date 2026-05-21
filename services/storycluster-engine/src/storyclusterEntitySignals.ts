export const LOW_SIGNAL_CANONICAL_ENTITIES = new Set([
  'donald_trump',
  'executive_order',
  'trump_executive_order',
  'cuba',
  'iran',
  'united_states',
  'united_kingdom',
  'uk',
  'us',
  'israel',
  'russia',
  'ukraine',
  'gaza',
  'tehran',
  'washington',
  'london',
  'sports',
  'sport',
  'title',
  'titles',
  'open',
  'final',
  'finals',
  'playoff',
  'playoffs',
  'tournament',
  'tournaments',
  'championship',
  'championships',
  'golf',
  'darts',
]);

const LOW_SIGNAL_COMPETITION_TERMS = new Set([
  'bowl',
  'championship',
  'classic',
  'cup',
  'derby',
  'final',
  'finals',
  'invitational',
  'league',
  'masters',
  'open',
  'playoff',
  'playoffs',
  'prix',
  'series',
  'tournament',
]);

export function isLowSignalCanonicalEntity(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!normalized) {
    return true;
  }
  if (LOW_SIGNAL_CANONICAL_ENTITIES.has(normalized)) {
    return true;
  }
  const tokens = normalized.split('_').filter(Boolean);
  return tokens.length <= 3 && tokens.some((token) => LOW_SIGNAL_COMPETITION_TERMS.has(token));
}
