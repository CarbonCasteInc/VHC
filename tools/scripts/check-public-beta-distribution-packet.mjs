import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DISTRIBUTION_PACKET_PATH = 'docs/ops/public-beta-distribution-packet-2026-07-09.md';

export const requiredDistributionFields = [
  'Release profile',
  'Release commit',
  'Control-record commit C',
  'S1 recovery closure',
  'Web PWA target URL',
  'Auth-callback target URL',
  'A6 deployed commit',
  'A6 service state',
  'Accepted synthesis status',
  'Source-health status',
  'StoryCluster production-readiness',
  'Providers enabled',
  'Release evidence packet',
  'MVP release gates',
  'MVP closeout',
  'Launch control',
  'Manual rehearsal',
  'Incident owner',
  'Alert-channel owner',
  'Pager/dead-man status',
  'Rollback owner',
  'Private support/escalation contact',
  'External release approval',
];

export const requiredDistributionEvidenceRows = [
  'Release evidence pipeline',
  'LUMA MVP readiness',
  'Source health',
  'StoryCluster production-readiness',
  'MVP release gates',
  'MVP closeout',
  'Public beta launch closeout',
  'Public beta compliance',
  'Launch content snapshot',
  'A6 readback',
  'Origin image readback',
  'Auth boundary health',
  'Provider rehearsal',
  'Three-browser rehearsal',
  'Privacy spot-check',
  'Alert delivery',
  'Canonical pager and external dead-man',
  'Failure-mailbox monitor',
  'Final S1 recovery tuple',
  'Serial A/B/C relay replacement',
  'Immediate publisher recovery',
  'S1 T0+24h evidence',
  'S1 T0+48h closure',
];

const allowedStatuses = new Set([
  'blocked_pending_release_evidence_rehearsal_and_live_fields',
  'go_for_public_beta_distribution',
]);

const sha256Token = 'sha256:[0-9a-f]{64}';

const goEnvelopeRequirements = [
  ['Release profile', /^`public-beta-ramp`$/],
  ['Release commit', /^`[0-9a-f]{40}`$/i],
  ['Control-record commit C', /^`this_record_commit`$/],
  ['S1 recovery closure', new RegExp(`^\`pass\`; evidence \`${sha256Token}\`$`, 'i')],
  ['Web PWA target URL', /^`https:\/\/venn\.carboncaste\.io`$/],
  ['Auth-callback target URL', /^`https:\/\/auth\.venn\.carboncaste\.io`$/],
  ['A6 deployed commit', /^`[0-9a-f]{40}`$/i],
  ['A6 service state', new RegExp(`^\`pass\`; evidence \`${sha256Token}\`$`, 'i')],
  ['Accepted synthesis status', new RegExp(`^\`pass\`; evidence \`${sha256Token}\`$`, 'i')],
  ['Source-health status', new RegExp(`^\`pass\`; evidence \`${sha256Token}\`$`, 'i')],
  ['StoryCluster production-readiness', new RegExp(`^\`release_ready\`; evidence \`${sha256Token}\`$`, 'i')],
  ['Providers enabled', /^`apple google`; `x` hidden\/excluded$/],
  ['Release evidence packet', /^`pass`; `release_commit_verified: true`; blockers `\[\]`; evidence `sha256:[0-9a-f]{64}`$/i],
  ['MVP release gates', new RegExp(`^\`pass\`; evidence \`${sha256Token}\`$`, 'i')],
  ['MVP closeout', new RegExp(`^\`pass\`; evidence \`${sha256Token}\`$`, 'i')],
  ['Launch control', new RegExp(`^\`go_for_public_beta_ramp\`; evidence \`${sha256Token}\`$`, 'i')],
  ['Manual rehearsal', new RegExp(`^\`pass\`; evidence \`${sha256Token}\`$`, 'i')],
  ['Incident owner', /^Lou$/],
  ['Alert-channel owner', /^Lou; `carboncasteit@gmail\.com`$/],
  ['Pager/dead-man status', new RegExp(`^\`pass\`; live proof recorded; evidence \`${sha256Token}\`$`, 'i')],
  ['Rollback owner', /^Lou authorizes; Codex prepares\/executes approved steps$/],
  ['Private support/escalation contact', /^`carboncasteit@gmail\.com`$/],
  ['External release approval', /^Lou: `(?:not_required_for_public_beta|approved)`(?:; rationale .+)?$/],
];

const expectedEvidenceStatus = new Map([
  ['StoryCluster production-readiness', 'release_ready'],
  ['Final S1 recovery tuple', 'GO'],
  ['Immediate publisher recovery', 'pass_interim'],
  ['S1 T0+24h evidence', 'pass_intermediate'],
]);

const forbiddenGoState = /\b(?:blocked|pending|TBD|NO_GO|not|unverified|missing)\b|(?:^|[\s/`])failure\.json\b/i;

function evidenceCellPattern(rowLabel) {
  const expectedStatus = expectedEvidenceStatus.get(rowLabel) ?? 'pass';
  const shaAndArtifact = '`sha256:[0-9a-f]{64}`; `(?:\\.tmp\\/[^`\\n]+|https:\\/\\/[^`\\n]+)`';
  const immutableRun = '`run_url:https:\\/\\/github\\.com\\/CarbonCasteInc\\/VHC\\/actions\\/runs\\/[1-9][0-9]*(?:\\/job\\/[1-9][0-9]*)?`';
  const immutableCommit = '`commit:[0-9a-f]{40}`';
  const suffix = rowLabel === 'Canonical pager and external dead-man'
    ? '; signed-alert; subscription; heartbeat; dead-man'
    : rowLabel === 'Failure-mailbox monitor'
      ? '; newCriticalCount == 0'
      : '';
  return new RegExp(
    `^\`status: ${escapeRegExp(expectedStatus)}\`; (?:${shaAndArtifact}|${immutableRun}|${immutableCommit})${escapeRegExp(suffix)}$`,
  );
}

const failureArtifactReference = /(?:^|\/)failure\.json(?:`|[?#;]|$)/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractStatus(content) {
  return {
    header: content.match(/^> Status:\s*`([^`]+)`\s*$/m)?.[1] ?? null,
    decision: content.match(/## Current Decision\s*\n\s*`([^`]+)`/m)?.[1] ?? null,
  };
}

function tableCell(content, rowLabel, columnIndex) {
  const row = content.match(new RegExp(`^\\|\\s*${escapeRegExp(rowLabel)}\\s*\\|[^\\n]+$`, 'm'))?.[0];
  if (!row) return null;
  const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
  return cells[columnIndex] ?? null;
}

function sectionTableCell(content, sectionHeading, rowLabel, columnIndex) {
  const sectionStart = content.indexOf(`## ${sectionHeading}`);
  if (sectionStart === -1) return null;
  const nextHeading = content.indexOf('\n## ', sectionStart + 4);
  const sectionEnd = nextHeading === -1 ? content.length : nextHeading;
  return tableCell(content.slice(sectionStart, sectionEnd), rowLabel, columnIndex);
}

export function validatePublicBetaDistributionPacket(content, options = {}) {
  const relPath = options.relPath ?? DISTRIBUTION_PACKET_PATH;
  const issues = [];
  const status = extractStatus(content);

  if (!status.header || !allowedStatuses.has(status.header)) {
    issues.push(`${relPath}: missing or unsupported header Status`);
  }
  if (!status.decision || !allowedStatuses.has(status.decision)) {
    issues.push(`${relPath}: missing or unsupported Current Decision`);
  }
  if (status.header && status.decision && status.header !== status.decision) {
    issues.push(`${relPath}: header Status must match Current Decision`);
  }

  for (const rowLabel of requiredDistributionFields) {
    if (sectionTableCell(content, 'Distribution Envelope', rowLabel, 1) === null) {
      issues.push(`${relPath}: missing ${rowLabel} distribution-envelope row`);
    }
  }
  for (const rowLabel of requiredDistributionEvidenceRows) {
    if (sectionTableCell(content, 'Required Evidence Paths', rowLabel, 2) === null) {
      issues.push(`${relPath}: missing ${rowLabel} evidence row`);
    }
  }

  const currentStatus = status.header ?? status.decision;
  if (currentStatus === 'blocked_pending_release_evidence_rehearsal_and_live_fields') {
    if (!/\bTBD(?:\([^)]+\))?\b/.test(content)) {
      issues.push(`${relPath}: blocked packet must retain explicit unresolved evidence placeholders`);
    }
    if (!/Do not invite testers while this status remains blocked/.test(content)) {
      issues.push(`${relPath}: blocked packet must explicitly prohibit tester invitations`);
    }
  }

  if (currentStatus === 'go_for_public_beta_distribution') {
    for (const [pattern, description] of [
      [/\bTBD(?:\([^)]+\))?\b/, 'TBD placeholders'],
      [/blocked_pending_release_evidence_rehearsal_and_live_fields/, 'blocked status text'],
      [/Do not invite testers while this status remains blocked/, 'blocked invitation rule'],
      [/This packet is not a release approval in its current state/, 'blocked approval statement'],
      [/Blocked state stays/, 'blocked-state control-record instruction'],
    ]) {
      if (pattern.test(content)) {
        issues.push(`${relPath}: distribution GO must not retain ${description}`);
      }
    }

    const validatedEnvelopeRows = new Set(goEnvelopeRequirements.map(([rowLabel]) => rowLabel));
    for (const rowLabel of requiredDistributionFields) {
      if (!validatedEnvelopeRows.has(rowLabel)) {
        issues.push(`${relPath}: distribution GO validator has no contract for ${rowLabel}`);
      }
    }

    for (const [rowLabel, requiredPattern] of goEnvelopeRequirements) {
      const currentValue = sectionTableCell(content, 'Distribution Envelope', rowLabel, 1);
      if (currentValue === null) continue;
      if (forbiddenGoState.test(currentValue) || !requiredPattern.test(currentValue)) {
        issues.push(`${relPath}: distribution GO ${rowLabel} value is not release-ready: ${currentValue}`);
      }
    }

    for (const rowLabel of requiredDistributionEvidenceRows) {
      const artifact = sectionTableCell(content, 'Required Evidence Paths', rowLabel, 2);
      if (artifact === null) continue;
      if (failureArtifactReference.test(artifact) || !evidenceCellPattern(rowLabel).test(artifact)) {
        issues.push(`${relPath}: distribution GO ${rowLabel} evidence is not bound to a passing artifact: ${artifact}`);
      }
    }

    const mailboxArtifact = sectionTableCell(content, 'Required Evidence Paths', 'Failure-mailbox monitor', 2) ?? '';
    if (!/newCriticalCount\s*==\s*0/.test(mailboxArtifact)) {
      issues.push(`${relPath}: distribution GO failure-mailbox evidence must record newCriticalCount == 0`);
    }

    const pagerArtifact = sectionTableCell(content, 'Required Evidence Paths', 'Canonical pager and external dead-man', 2) ?? '';
    for (const token of ['signed-alert', 'subscription', 'heartbeat', 'dead-man']) {
      if (!pagerArtifact.includes(token)) {
        issues.push(`${relPath}: distribution GO pager evidence must bind ${token}`);
      }
    }
  }

  return issues;
}

function main() {
  const content = readFileSync(DISTRIBUTION_PACKET_PATH, 'utf8');
  const issues = validatePublicBetaDistributionPacket(content);
  if (issues.length > 0) {
    console.error('Public Beta Distribution Packet: FAIL');
    for (const issue of issues) console.error(` - ${issue}`);
    process.exit(1);
  }
  const { header } = extractStatus(content);
  console.log(`Public Beta Distribution Packet: PASS (${header})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
