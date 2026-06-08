function parsedJsonObject(candidate) {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(candidate.trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function candidateJsonStrings(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return [];

  const candidates = [];
  const seen = new Set();
  const add = (candidate) => {
    const value = candidate.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.startsWith('{')) add(line);
  }

  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index] === '{') add(trimmed.slice(index));
  }

  return candidates;
}

export function parseLastJsonObjectFromOutput(...streams) {
  for (const stream of streams) {
    for (const candidate of candidateJsonStrings(stream)) {
      const parsed = parsedJsonObject(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}
