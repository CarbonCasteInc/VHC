export function normalizeAlertClassFamily(alertClass) {
  const text = String(alertClass ?? '').trim();
  if (!text) return 'unknown';
  if (text.startsWith('exit_69')) return 'exit_69';
  if (text.startsWith('exit_75')) return 'exit_75';
  if (text.startsWith('exit_78')) return 'exit_78';
  if (text.startsWith('public_feed')) return 'public_feed';
  if (text.startsWith('relay_liveness')) return 'relay_liveness';
  if (text.startsWith('relay_snapshot')) return 'relay_snapshot';
  if (text.startsWith('watch_closure')) return 'watch_closure';
  if (text.includes('freshness')) return 'freshness';
  return text.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
}
