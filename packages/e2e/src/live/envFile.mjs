import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === '#' && quote === null && /\s/.test(value[index - 1] ?? '')) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function unescapeDoubleQuoted(value) {
  return value.replace(/\\([nrt"\\])/g, (_match, escaped) => {
    switch (escaped) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return escaped;
    }
  });
}

export function parseEnvFile(text) {
  const entries = [];
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const assignment = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }

    const key = assignment.slice(0, separatorIndex).trim();
    if (!ENV_KEY_RE.test(key)) {
      continue;
    }

    const rawValue = stripInlineComment(assignment.slice(separatorIndex + 1).trim());
    let value = rawValue;
    if (rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')) {
      value = unescapeDoubleQuoted(rawValue.slice(1, -1));
    } else if (rawValue.length >= 2 && rawValue.startsWith("'") && rawValue.endsWith("'")) {
      value = rawValue.slice(1, -1);
    }

    entries.push([key, value]);
  }

  return entries;
}

export function loadEnvFileFromEnv({
  env = process.env,
  envFileVariable = 'ENV_FILE',
  exists = existsSync,
  readFile = readFileSync,
  cwd = process.cwd(),
} = {}) {
  const configuredPath = env[envFileVariable]?.trim();
  if (!configuredPath) {
    return {
      loaded: false,
      path: null,
      loadedKeys: [],
      skippedKeys: [],
    };
  }

  const envFilePath = path.resolve(cwd, configuredPath);
  if (!exists(envFilePath)) {
    throw new Error(`${envFileVariable} not found: ${envFilePath}`);
  }

  const loadedKeys = [];
  const skippedKeys = [];
  for (const [key, value] of parseEnvFile(readFile(envFilePath, 'utf8'))) {
    if (typeof env[key] === 'string' && env[key] !== '') {
      skippedKeys.push(key);
      continue;
    }
    env[key] = value;
    loadedKeys.push(key);
  }

  return {
    loaded: true,
    path: envFilePath,
    loadedKeys,
    skippedKeys,
  };
}
