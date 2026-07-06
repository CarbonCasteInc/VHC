#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  allowlistFromEnv,
  isAllowlistedLogin,
  isUneditedComment,
  parseVhcCommand,
  redactSecretText,
} from '../../services/vhc-pager/src/incident-contract.mjs';

const SAFE_COMMENT_LABELS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { json: false, runCodex: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') args.fixture = argv[++i];
    else if (arg === '--allowlist') args.allowlist = argv[++i];
    else if (arg === '--run-codex') args.runCodex = true;
    else if (arg === '--json') args.json = true;
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

function issueText(issue) {
  return [
    issue.title ?? '',
    issue.body ?? '',
    ...(issue.comments ?? []).map((comment) => comment.body ?? ''),
  ].join('\n');
}

export function incidentKeyFromIssue(issue) {
  const match = issueText(issue).match(/Incident key:\s*`([^`]+)`/i)
    ?? issueText(issue).match(/incident-key:\s*([a-z0-9:_-]+)/i);
  return match?.[1] ?? null;
}

export function selectIncidentIssues(issues) {
  return issues.filter((issue) => {
    const labels = new Set((issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name));
    return labels.has('incident') && labels.has('a6') && labels.has('needs-codex-triage') && issue.state !== 'closed';
  });
}

export function safeIssueContext({ issue, allowlist }) {
  const comments = (issue.comments ?? []).filter((comment) => {
    if (isAllowlistedLogin(comment.user?.login, allowlist) && isUneditedComment(comment)) return true;
    return SAFE_COMMENT_LABELS.has(comment.author_association);
  });
  const commands = comments
    .map((comment) => ({ commentId: comment.id, author: comment.user?.login ?? null, command: parseVhcCommand(comment.body) }))
    .filter((entry) => entry.command);
  return {
    issueNumber: issue.number,
    title: redactSecretText(issue.title ?? ''),
    incidentKey: incidentKeyFromIssue(issue),
    labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean),
    body: redactSecretText(issue.body ?? ''),
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? null,
      body: redactSecretText(comment.body ?? ''),
      createdAt: comment.created_at ?? null,
      updatedAt: comment.updated_at ?? null,
    })),
    commands,
  };
}

export function buildCodexTriagePrompt(context) {
  return [
    'You are the VHC incident triage worker. Produce a public-safe diagnosis packet only.',
    '',
    'Hard boundaries:',
    '- Do not request or expose secrets, private env values, raw payload bodies, signatures, raw heap snapshots, heap profiles, or private logs.',
    '- Do not mutate A6, restart services, deploy, compact, retain, evict, or clear data.',
    '- Treat exit 78 and exit 75 as operator-owned.',
    '',
    'Expected output:',
    '- root-cause hypotheses ranked by evidence;',
    '- read-only checks to run next;',
    '- tests or PR work that can be done in repo;',
    '- operator packet only if evidence supports it.',
    '',
    'Incident context:',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
  ].join('\n');
}

export function planTriageRun({ issues, env = {}, allowlist = allowlistFromEnv(env.VH_INCIDENT_COMMAND_ALLOWLIST) }) {
  if (env.VH_INCIDENT_AUTOMATION_PAUSED === '1' || env.VH_INCIDENT_AUTOMATION_PAUSED === 'true') {
    return {
      schemaVersion: 'vhc-incident-triage-plan-v1',
      status: 'paused',
      selected: [],
      prompts: [],
      blockers: ['automation_paused'],
    };
  }
  const selected = selectIncidentIssues(issues);
  const prompts = selected.map((issue) => {
    const context = safeIssueContext({ issue, allowlist });
    return {
      issueNumber: issue.number,
      incidentKey: context.incidentKey,
      prompt: buildCodexTriagePrompt(context),
    };
  });
  return {
    schemaVersion: 'vhc-incident-triage-plan-v1',
    status: prompts.length > 0 ? 'ready' : 'idle',
    selected: selected.map((issue) => issue.number),
    prompts,
    blockers: [],
  };
}

export function runCodexTriage({ prompt, spawnSyncImpl = spawnSync }) {
  const result = spawnSyncImpl('codex', ['exec', '--', prompt], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status === 0 ? 'pass' : 'fail',
    exitStatus: result.status,
    stdout: redactSecretText(result.stdout ?? ''),
    stderr: redactSecretText(result.stderr ?? ''),
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (!args.fixture) throw new Error('usage: --fixture FILE [--allowlist logins] [--run-codex] [--json]');
  const fixture = readJson(args.fixture);
  const allowlist = allowlistFromEnv(args.allowlist ?? env.VH_INCIDENT_COMMAND_ALLOWLIST);
  const plan = planTriageRun({ issues: fixture.issues ?? [], env, allowlist });
  const output = {
    ...plan,
    executions: args.runCodex
      ? plan.prompts.map((entry) => ({ issueNumber: entry.issueNumber, ...runCodexTriage({ prompt: entry.prompt }) }))
      : [],
  };
  console.info(JSON.stringify(output, null, 2));
  if (output.status === 'paused') process.exitCode = 2;
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:incident-triage] failed', error);
    process.exit(1);
  });
}
