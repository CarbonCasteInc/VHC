import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, 'docs');

const authoritativeRoots = [
  path.join(repoRoot, 'docs', 'foundational'),
  path.join(repoRoot, 'docs', 'specs'),
  path.join(repoRoot, 'docs', 'ops'),
];

const nonAuthoritativeRoots = [
  path.join(repoRoot, 'docs', 'plans'),
  path.join(repoRoot, 'docs', 'sprints'),
];

const requiredMetadataKeys = ['Status', 'Owner', 'Last Reviewed', 'Depends On'];
const authorityPhraseAllowlist = new Set([
  'docs/plans/TEMP_DOCS_AUDIT_REFERENCE_2026-03-03.md',
]);

const linkCheckSkiplist = new Set([
  'docs/plans/TEMP_DOCS_AUDIT_REFERENCE_2026-03-03.md',
]);

const forbiddenAuthorityPatterns = [
  /\bsource[- ]of[- ]truth\b/i,
  /\bthis\s+document\s+is\s+(?:the\s+)?canonical\b/i,
  /\bthis\s+(?:doc|document)\s+is\s+(?:the\s+)?authoritative\b/i,
];

function walkMarkdownFiles(dir, out = []) {
  if (!statSync(dir).isDirectory()) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function toRepoRelative(fullPath) {
  return path.relative(repoRoot, fullPath).replaceAll(path.sep, '/');
}

function lineForIndex(content, index) {
  return content.slice(0, index).split('\n').length;
}

function sanitizeTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  }
  const trailingTitlePatterns = [
    /\s+"[^"]*"$/,
    /\s+'[^']*'$/,
  ];
  for (const pattern of trailingTitlePatterns) {
    const match = target.match(pattern);
    if (match && match.index !== undefined) {
      target = target.slice(0, match.index);
      break;
    }
  }
  return target;
}

function resolveInternalMarkdownTarget(currentFile, rawTarget) {
  const target = sanitizeTarget(rawTarget);
  if (!target) return null;
  if (target.startsWith('#')) return null;
  if (/^(?:https?:|mailto:|tel:)/i.test(target)) return null;

  const withoutFragment = target.split('#')[0].split('?')[0];
  if (!withoutFragment) return null;
  if (withoutFragment.includes('*')) return null;

  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }

  const isMarkdownPath = decoded.endsWith('.md');
  const isDocsRooted = decoded.startsWith('docs/') || decoded.startsWith('/docs/');
  if (!isMarkdownPath && !isDocsRooted) return null;

  if (decoded.startsWith('/docs/')) {
    return path.join(repoRoot, decoded.slice(1));
  }

  if (decoded.startsWith('docs/')) {
    return path.join(repoRoot, decoded);
  }

  return path.resolve(path.dirname(currentFile), decoded);
}

function checkRequiredMetadata(files) {
  const issues = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const headerWindow = content.split('\n').slice(0, 80).join('\n');

    for (const key of requiredMetadataKeys) {
      const pattern = new RegExp(`^> ${key}:\\s*.+$`, 'm');
      if (!pattern.test(headerWindow)) {
        issues.push(`${toRepoRelative(file)}: missing metadata field "> ${key}: ..."`);
      }
    }
  }
  return issues;
}

function checkInternalLinks(files) {
  const issues = [];

  for (const file of files) {
    const rel = toRepoRelative(file);
    if (linkCheckSkiplist.has(rel)) continue;

    const content = readFileSync(file, 'utf8');

    const markdownLinkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
    for (const match of content.matchAll(markdownLinkRegex)) {
      const rawTarget = match[1] ?? '';
      const resolved = resolveInternalMarkdownTarget(file, rawTarget);
      if (!resolved) continue;
      try {
        statSync(resolved);
      } catch {
        const line = lineForIndex(content, match.index ?? 0);
        issues.push(`${toRepoRelative(file)}:${line}: missing link target ${sanitizeTarget(rawTarget)}`);
      }
    }

    const codePathRegex = /`(\/?docs\/[^`\n]+?\.md)`/g;
    for (const match of content.matchAll(codePathRegex)) {
      const rawTarget = match[1] ?? '';
      const resolved = resolveInternalMarkdownTarget(file, rawTarget);
      if (!resolved) continue;
      try {
        statSync(resolved);
      } catch {
        const line = lineForIndex(content, match.index ?? 0);
        issues.push(`${toRepoRelative(file)}:${line}: missing docs path ${rawTarget}`);
      }
    }
  }

  return issues;
}

function checkAuthorityLanguage(files) {
  const issues = [];
  for (const file of files) {
    const rel = toRepoRelative(file);
    if (authorityPhraseAllowlist.has(rel)) continue;

    const content = readFileSync(file, 'utf8');
    for (const pattern of forbiddenAuthorityPatterns) {
      const match = pattern.exec(content);
      if (!match) continue;

      const line = lineForIndex(content, match.index ?? 0);
      issues.push(`${rel}:${line}: disallowed authority phrase "${match[0]}" in non-authoritative doc`);
    }
  }
  return issues;
}

function main() {
  const allDocsFiles = walkMarkdownFiles(docsRoot).sort();
  const authoritativeFiles = authoritativeRoots.flatMap((dir) => walkMarkdownFiles(dir)).sort();
  const nonAuthoritativeFiles = nonAuthoritativeRoots.flatMap((dir) => walkMarkdownFiles(dir)).sort();

  const issues = [
    ...checkRequiredMetadata(authoritativeFiles),
    ...checkInternalLinks(allDocsFiles),
    ...checkAuthorityLanguage(nonAuthoritativeFiles),
  ];

  if (issues.length > 0) {
    console.error('Docs Governance: FAIL');
    for (const issue of issues) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  console.log(`Docs Governance: PASS (${allDocsFiles.length} markdown files checked)`);
}

main();
