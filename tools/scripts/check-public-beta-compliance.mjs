import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredPages = [
  { id: 'beta', route: '/beta', title: 'VHC Public Beta Scope' },
  { id: 'privacy', route: '/privacy', title: 'Privacy Notice' },
  { id: 'terms', route: '/terms', title: 'Beta Terms' },
  { id: 'moderation', route: '/moderation', title: 'UGC and Moderation Policy' },
  { id: 'support', route: '/support', title: 'Beta Support and Contact' },
  { id: 'data-deletion', route: '/data-deletion', title: 'Data Deletion and Local State' },
  { id: 'telemetry', route: '/telemetry', title: 'Telemetry and Remote AI Consent' },
  { id: 'copyright', route: '/copyright', title: 'Content and Copyright Boundaries' },
];

const complianceIndex = { route: '/compliance', title: 'Public beta policy surfaces' };

const files = {
  packageJson: 'package.json',
  routes: 'apps/web-pwa/src/routes/index.tsx',
  compliance: 'apps/web-pwa/src/routes/publicBetaCompliance.tsx',
  engineSettings: 'apps/web-pwa/src/components/EngineSettings.tsx',
  newsCardBack: 'apps/web-pwa/src/components/feed/NewsCardBack.tsx',
  commentStream: 'apps/web-pwa/src/components/hermes/CommentStream.tsx',
  docs: 'docs/ops/public-beta-compliance-minimums.md',
  roadmap: 'docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md',
};

const issues = [];

function readRepoFile(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  try {
    statSync(fullPath);
  } catch {
    issues.push(`${relPath}: missing required file`);
    return '';
  }
  return readFileSync(fullPath, 'utf8');
}

function requireIncludes(relPath, content, needle, description = needle) {
  if (!content.includes(needle)) {
    issues.push(`${relPath}: missing ${description}`);
  }
}

function requireRegex(relPath, content, regex, description) {
  if (!regex.test(content)) {
    issues.push(`${relPath}: missing ${description}`);
  }
}

const packageJson = JSON.parse(readRepoFile(files.packageJson));
const routes = readRepoFile(files.routes);
const compliance = readRepoFile(files.compliance);
const engineSettings = readRepoFile(files.engineSettings);
const newsCardBack = readRepoFile(files.newsCardBack);
const commentStream = readRepoFile(files.commentStream);
const docs = readRepoFile(files.docs);
const roadmap = readRepoFile(files.roadmap);

if (packageJson.scripts?.['check:public-beta-compliance'] !== 'node ./tools/scripts/check-public-beta-compliance.mjs') {
  issues.push('package.json: missing check:public-beta-compliance script');
}

requireIncludes(files.routes, routes, '<ComplianceFooter />', 'global compliance footer');
requireIncludes(files.routes, routes, `path: '${complianceIndex.route}'`, `${complianceIndex.route} route`);
requireIncludes(files.compliance, compliance, `to="${complianceIndex.route}"`, 'footer link to compliance index');
requireIncludes(files.compliance, compliance, complianceIndex.title, `${complianceIndex.title} page title`);
requireIncludes(files.docs, docs, `| \`${complianceIndex.route}\` |`, `${complianceIndex.route} checklist row`);
requireIncludes(files.engineSettings, engineSettings, 'href="/telemetry"', 'remote AI telemetry policy link');
requireIncludes(files.newsCardBack, newsCardBack, 'href="/moderation"', 'synthesis report moderation policy link');
requireIncludes(files.commentStream, commentStream, 'href="/moderation"', 'comment report moderation policy link');

for (const page of requiredPages) {
  requireIncludes(files.compliance, compliance, `id: '${page.id}'`, `${page.id} page id`);
  requireIncludes(files.compliance, compliance, `route: '${page.route}'`, `${page.route} page route`);
  requireIncludes(files.compliance, compliance, page.title, `${page.title} page title`);
  requireIncludes(files.routes, routes, `path: '${page.route}'`, `${page.route} router entry`);
  requireIncludes(files.docs, docs, `| \`${page.route}\` |`, `${page.route} checklist row`);
  requireIncludes(files.docs, docs, page.title, `${page.title} docs reference`);
}

const requiredDocsPhrases = [
  'Privacy, terms, UGC/moderation, support/contact, data deletion, telemetry/remote AI consent, and content/copyright boundaries',
  'This is not legal approval',
  'Public beta remains blocked if an operator cannot provide a reachable support/contact channel',
  'trust-gated operator roles remain outside this minimum',
  'Public reports are workflow records, not a private support inbox',
  'validated snapshot does not prove live-feed freshness',
];

for (const phrase of requiredDocsPhrases) {
  requireIncludes(files.docs, docs, phrase);
}

requireRegex(
  files.roadmap,
  roadmap,
  /Compliance \| Go for public beta policy surfaces;/,
  'compliance go/no-go row updated for policy surfaces',
);
requireRegex(
  files.roadmap,
  roadmap,
  /Privacy\/UGC\/deletion checklist \| .*public_beta_compliance/,
  'release gate inventory entry for public beta compliance',
);

const overclaimFiles = [
  [files.compliance, compliance],
  [files.docs, docs],
  [files.roadmap, roadmap],
];

const forbiddenOverclaimPatterns = [
  /\bverified[- ]human system is active\b/i,
  /\bone[- ]human[- ]one[- ]vote assurance is active\b/i,
  /\bSybil[- ]resistant proof is active\b/i,
  /\blegal approval complete\b/i,
  /\bApp Store ready\b/i,
  /\bTestFlight ready\b/i,
  /\bcomplete trust[- ]and[- ]safety program is implemented\b/i,
  /\bfull moderation operations program is implemented\b/i,
];

for (const [relPath, content] of overclaimFiles) {
  for (const pattern of forbiddenOverclaimPatterns) {
    const match = content.match(pattern);
    if (match) {
      issues.push(`${relPath}: forbidden public-beta overclaim "${match[0]}"`);
    }
  }
}

if (issues.length > 0) {
  console.error('Public Beta Compliance: FAIL');
  for (const issue of issues) {
    console.error(` - ${issue}`);
  }
  process.exit(1);
}

console.log(`Public Beta Compliance: PASS (${requiredPages.length} policy routes checked)`);
