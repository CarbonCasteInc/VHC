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
const supportContact = {
  label: 'Open VHC public beta support request',
  href: 'https://github.com/CarbonCasteInc/VHC/issues/new?template=public-beta-support.yml',
  issueTemplatePath: '.github/ISSUE_TEMPLATE/public-beta-support.yml',
};

const files = {
  packageJson: 'package.json',
  routes: 'apps/web-pwa/src/routes/index.tsx',
  compliance: 'apps/web-pwa/src/routes/publicBetaCompliance.tsx',
  engineSettings: 'apps/web-pwa/src/components/EngineSettings.tsx',
  newsCardBack: 'apps/web-pwa/src/components/feed/NewsCardBack.tsx',
  commentStream: 'apps/web-pwa/src/components/hermes/CommentStream.tsx',
  docs: 'docs/ops/public-beta-compliance-minimums.md',
  roadmap: 'docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md',
  supportIssueTemplate: supportContact.issueTemplatePath,
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
const supportIssueTemplate = readRepoFile(files.supportIssueTemplate);

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
requireIncludes(files.compliance, compliance, 'PUBLIC_BETA_SUPPORT_CONTACT', 'typed support contact config');
requireIncludes(files.compliance, compliance, supportContact.href, 'provisioned support contact URL');
requireIncludes(files.compliance, compliance, supportContact.label, 'provisioned support contact label');
requireIncludes(files.compliance, compliance, 'data-testid="public-beta-support-contact-link"', 'support contact link');
requireIncludes(files.compliance, compliance, 'public GitHub issue', 'public issue support notice');
requireIncludes(files.docs, docs, supportContact.href, 'provisioned support contact URL docs reference');
requireIncludes(files.docs, docs, supportContact.issueTemplatePath, 'support issue template docs reference');
requireIncludes(files.supportIssueTemplate, supportIssueTemplate, 'name: Public beta support request', 'support issue template name');
requireIncludes(files.supportIssueTemplate, supportIssueTemplate, 'Do not include private personal data', 'support issue template privacy warning');
requireIncludes(files.supportIssueTemplate, supportIssueTemplate, 'Data deletion or correction', 'support issue deletion category');
requireIncludes(files.supportIssueTemplate, supportIssueTemplate, 'Copyright or attribution concern', 'support issue copyright category');

try {
  const parsedSupportUrl = new URL(supportContact.href);
  if (parsedSupportUrl.protocol !== 'https:') {
    issues.push('support contact: URL must use https');
  }
  if (parsedSupportUrl.hostname !== 'github.com') {
    issues.push('support contact: URL must point to github.com');
  }
  if (parsedSupportUrl.pathname !== '/CarbonCasteInc/VHC/issues/new') {
    issues.push('support contact: URL must open a new issue in CarbonCasteInc/VHC');
  }
  if (parsedSupportUrl.searchParams.get('template') !== 'public-beta-support.yml') {
    issues.push('support contact: URL must select the public beta support issue template');
  }
} catch {
  issues.push('support contact: URL is malformed');
}

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
  'The reachable public beta support channel is the VHC GitHub Issue Form',
  'trust-gated operator roles remain outside this minimum',
  'Public reports are workflow records, not a private support inbox',
  'Support requests are public workflow records, not private correspondence',
  'validated snapshot does not prove live-feed freshness',
];

for (const phrase of requiredDocsPhrases) {
  requireIncludes(files.docs, docs, phrase);
}

requireRegex(
  files.roadmap,
  roadmap,
  /Compliance \| Go for public beta policy surfaces and provisioned support\/contact;/,
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

const forbiddenSupportPlaceholderPatterns = [
  /\boperator-provided contact channel\b/i,
  /\bbeta operator contact channel\b/i,
  /\bchannel supplied with your beta invitation\b/i,
  /\bwait for an operator-provided contact path\b/i,
  /\bPublic beta remains blocked if an operator cannot provide\b/i,
  /\bsupport@example\.com\b/i,
  /\bTODO\b[^\n]*(support|contact)/i,
  /\bTBD\b[^\n]*(support|contact)/i,
  /\bplaceholder\b[^\n]*(support|contact)/i,
];

for (const [relPath, content] of overclaimFiles) {
  for (const pattern of forbiddenOverclaimPatterns) {
    const match = content.match(pattern);
    if (match) {
      issues.push(`${relPath}: forbidden public-beta overclaim "${match[0]}"`);
    }
  }
  for (const pattern of forbiddenSupportPlaceholderPatterns) {
    const match = content.match(pattern);
    if (match) {
      issues.push(`${relPath}: forbidden support/contact placeholder "${match[0]}"`);
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

console.log(`Public Beta Compliance: PASS (${requiredPages.length} policy routes and support channel checked)`);
