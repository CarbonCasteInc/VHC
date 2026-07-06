import { redactSecretText } from './incident-contract.mjs';

const BRIDGE_SENTINEL = '<!-- vhc-incident:v1 -->';
const BRIDGE_OWNED_LABEL = 'vhc-pager-bridge';
const BRIDGE_REQUIRED_LABELS = Object.freeze(['incident', 'a6', 'public-feed', 'needs-codex-triage', BRIDGE_OWNED_LABEL]);

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function labelSetForAlert(alert) {
  const severity = alert.severity === 'critical' ? 'severity:critical' : 'severity:warning';
  return [...BRIDGE_REQUIRED_LABELS, severity, 'reviewer:fable'];
}

export function incidentIssueTitle({ incidentKey, alert }) {
  return `[A6 incident] ${alert.severity ?? 'info'} ${alert.alertClass ?? incidentKey}`;
}

export function incidentIssueBody({ incidentKey, alert, sourceFingerprint }) {
  return [
    BRIDGE_SENTINEL,
    `Incident key: \`${incidentKey}\``,
    `Schema: \`vhc-incident-v1\``,
    '',
    '## Alert Summary',
    '',
    `- Severity: \`${alert.severity ?? 'unknown'}\``,
    `- Alert class: \`${alert.alertClass ?? 'unknown'}\``,
    `- Source fingerprint: \`${sourceFingerprint ?? alert.fingerprint ?? 'missing'}\``,
    `- First seen: \`${alert.generatedAt ?? 'missing'}\``,
    `- Last seen: \`${alert.generatedAt ?? 'missing'}\``,
    `- Affected service: \`A6 public feed\``,
    `- Current status: \`${alert.status ?? 'unknown'}\``,
    '',
    '## Safe Evidence',
    '',
    '```json',
    JSON.stringify({
      publisher: alert.publisher,
      freshness: alert.freshness,
      relayLiveness: alert.relayLiveness,
      relaySnapshot: alert.relaySnapshot,
      watchClosure: alert.watchClosure,
      blockers: alert.blockers,
    }, null, 2),
    '```',
    '',
    '## Boundaries',
    '',
    '- Public-safe case file only.',
    '- Do not paste secrets, webhook URLs, private env values, raw payload bodies, signatures, raw heap snapshots, heap profiles, or private logs.',
    '- Codex may investigate, draft PRs, and draft operator packets. It may not execute live A6 mutation from this issue text.',
    '',
    '## Workflow State',
    '',
    '- Reviewer: `fable`',
    '- Approval state: `not_requested`',
    '- Execution packet hash: `none`',
    '- Readback state: `not_started`',
  ].map(redactSecretText).join('\n');
}

export function isBridgeOwnedIncidentIssue(issue, incidentKey) {
  const body = String(issue?.body ?? '');
  const labels = new Set((issue?.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean));
  const hasBridgeLabels = BRIDGE_REQUIRED_LABELS.every((label) => labels.has(label))
    && [...labels].some((label) => label === 'severity:critical' || label === 'severity:warning');
  return body.includes(BRIDGE_SENTINEL)
    && body.includes(`Incident key: \`${incidentKey}\``)
    && body.includes('Schema: `vhc-incident-v1`')
    && hasBridgeLabels;
}

export function recoveryComment({ incidentKey, alert }) {
  return redactSecretText([
    `Recovery observed for \`${incidentKey}\`.`,
    '',
    `- Generated at: \`${alert.generatedAt ?? 'missing'}\``,
    `- Status: \`${alert.status ?? 'unknown'}\``,
    `- Fingerprint: \`${alert.fingerprint ?? 'missing'}\``,
  ].join('\n'));
}

export function timelineComment({ incidentKey, alert }) {
  return redactSecretText([
    `Incident update for \`${incidentKey}\`.`,
    '',
    `- Severity: \`${alert.severity ?? 'unknown'}\``,
    `- Alert class: \`${alert.alertClass ?? 'unknown'}\``,
    `- Status: \`${alert.status ?? 'unknown'}\``,
    `- Fingerprint: \`${alert.fingerprint ?? 'missing'}\``,
    `- Blockers: \`${(alert.blockers ?? []).join(', ') || 'none'}\``,
  ].join('\n'));
}

export class GitHubIncidentBridge {
  constructor({ owner, repo, token, fetchImpl = fetch }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  api(path) {
    return `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
  }

  async request(path, init = {}) {
    const response = await this.fetchImpl(this.api(path), {
      ...init,
      headers: {
        ...githubHeaders(this.token),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`github_http_${response.status}:${body?.message ?? 'unknown'}`);
    }
    return body;
  }

  async findOpenIncidentIssue(incidentKey) {
    const labels = encodeURIComponent(BRIDGE_REQUIRED_LABELS.join(','));
    const result = await this.request(`/issues?state=open&labels=${labels}&per_page=50`);
    return result.find((issue) => isBridgeOwnedIncidentIssue(issue, incidentKey)) ?? null;
  }

  async createIssue({ incidentKey, alert }) {
    return this.request('/issues', {
      method: 'POST',
      body: JSON.stringify({
        title: incidentIssueTitle({ incidentKey, alert }),
        body: incidentIssueBody({ incidentKey, alert, sourceFingerprint: alert.fingerprint }),
        labels: labelSetForAlert(alert),
      }),
    });
  }

  async createComment(issueNumber, body) {
    return this.request(`/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: redactSecretText(body) }),
    });
  }

  async updateIssueLabels(issueNumber, labels) {
    return this.request(`/issues/${issueNumber}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ labels }),
    });
  }

  async createOrUpdateIncident({ incidentKey, alert }) {
    const existing = await this.findOpenIncidentIssue(incidentKey);
    if (!existing) {
      const issue = await this.createIssue({ incidentKey, alert });
      return { status: 'created', issue };
    }
    const body = alert.status === 'pass'
      ? recoveryComment({ incidentKey, alert })
      : timelineComment({ incidentKey, alert });
    const comment = await this.createComment(existing.number, body);
    await this.updateIssueLabels(existing.number, [...new Set([...labelSetForAlert(alert), ...(alert.status === 'pass' ? ['waiting-for-readback'] : [])])]);
    return { status: 'updated', issue: existing, comment };
  }
}
