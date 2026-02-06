import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const WEB_PWA_SRC_DIR = resolve(PROJECT_ROOT, 'apps/web-pwa/src');
const IDENTITY_VAULT_SRC_DIR = resolve(PROJECT_ROOT, 'packages/identity-vault/src');

const FORBIDDEN_VAULT_KEY_PATTERNS = [
  'vh-vault',
  'vh_identity',
  'session_token',
  'master_key',
  'nullifier',
  'trust_score'
] as const;

const SAFE_STORAGE_CALL_START = /\b(safeSetItem|safeGetItem)\s*\(/g;

interface SafeStorageCall {
  callee: 'safeSetItem' | 'safeGetItem';
  args: string;
  line: number;
}

function listFilesRecursively(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function isWebSourceFile(filePath: string): boolean {
  return (
    /\.(ts|tsx)$/.test(filePath) &&
    !filePath.endsWith('.d.ts') &&
    !filePath.endsWith('.test.ts') &&
    !filePath.endsWith('.test.tsx') &&
    !filePath.endsWith('.spec.ts') &&
    !filePath.endsWith('.spec.tsx')
  );
}

function isTypeScriptFile(filePath: string): boolean {
  return /\.(ts|tsx)$/.test(filePath) && !filePath.endsWith('.d.ts');
}

function findMatchingParenIndex(source: string, openParenIndex: number): number {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = openParenIndex + 1; i < source.length; i += 1) {
    const char = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inSingle) {
      if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (char === '\\') {
        escaped = true;
      } else if (char === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function extractFirstArgument(args: string): string {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inSingle) {
      if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (char === '\\') {
        escaped = true;
      } else if (char === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      continue;
    }

    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      continue;
    }

    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return args.slice(0, i).trim();
    }
  }

  return args.trim();
}

function findSafeStorageCalls(source: string): SafeStorageCall[] {
  const calls: SafeStorageCall[] = [];
  let match = SAFE_STORAGE_CALL_START.exec(source);

  while (match) {
    const callee = match[1] as SafeStorageCall['callee'];
    const openParenIndex = source.indexOf('(', match.index);

    if (openParenIndex !== -1) {
      const closeParenIndex = findMatchingParenIndex(source, openParenIndex);

      if (closeParenIndex !== -1) {
        const args = source.slice(openParenIndex + 1, closeParenIndex);
        const line = source.slice(0, match.index).split('\n').length;
        calls.push({ callee, args, line });
      }
    }

    match = SAFE_STORAGE_CALL_START.exec(source);
  }

  return calls;
}

function extractLiteralSegments(expression: string): string[] {
  const segments: string[] = [];
  const literalPattern = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;

  let match = literalPattern.exec(expression);
  while (match) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const staticText = raw.replace(/\$\{[^}]*\}/g, '');
    if (staticText.length > 0) {
      segments.push(staticText);
    }
    match = literalPattern.exec(expression);
  }

  return segments;
}

function usesForbiddenVaultPattern(value: string): boolean {
  const normalized = value.toLowerCase();
  return FORBIDDEN_VAULT_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function hasSafeStorageImport(source: string): boolean {
  return (
    /\bfrom\s+['"][^'"]*safeStorage[^'"]*['"]/.test(source) ||
    /\brequire\s*\(\s*['"][^'"]*safeStorage[^'"]*['"]\s*\)/.test(source) ||
    /\bimport\s*\(\s*['"][^'"]*safeStorage[^'"]*['"]\s*\)/.test(source)
  );
}

describe('secure storage policy static audit', () => {
  it('keeps vault-tier key patterns out of safeStorage calls in web-pwa source', () => {
    const webSourceFiles = listFilesRecursively(WEB_PWA_SRC_DIR).filter(isWebSourceFile);
    const violations: string[] = [];
    let callCount = 0;

    for (const filePath of webSourceFiles) {
      const source = readFileSync(filePath, 'utf8');
      const calls = findSafeStorageCalls(source);
      callCount += calls.length;

      for (const call of calls) {
        const firstArg = extractFirstArgument(call.args);
        const literalSegments = extractLiteralSegments(firstArg);
        const hasViolation = literalSegments.some(usesForbiddenVaultPattern);

        if (hasViolation) {
          violations.push(`${relative(PROJECT_ROOT, filePath)}:${call.line} ${call.callee}(${firstArg})`);
        }
      }
    }

    expect(callCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('prevents identity-vault source from importing safeStorage', () => {
    const vaultFiles = listFilesRecursively(IDENTITY_VAULT_SRC_DIR).filter(isTypeScriptFile);
    const violations = vaultFiles
      .filter((filePath) => hasSafeStorageImport(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(PROJECT_ROOT, filePath));

    expect(violations).toEqual([]);
  });
});
