import { redactSecretText } from './incident-contract.mjs';

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function labelSetForAlert(alert) {
  const severity = alert.severity === 'critical' ? 'severity:critical' : 'severity:warning';
  return ['incident', 'a6', 'public-feed', severity, 'needs-codex-triage', 'reviewer:fable'];
}

export function incidentIssueTitle({ incidentKey, alert }) {
  return `[A6 incident] ${alert.severity ?? 'info'} ${alert.alertClass ?? incidentKey}`;
}

export function incidentIssueBody({ incidentKey, alert, sourceFingerprint }) {
  return [
    '<!-- vhc-incident:v1 -->',
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
    const query = encodeURIComponent(`repo:${this.owner}/${this.repo} is:issue is:open label:incident "${incidentKey}"`);
    const result = await this.request(`/issues?state=open&labels=incident&per_page=50`);
    return result.find((issue) => String(issue.body ?? '').includes(`Incident key: \`${incidentKey}\``)) ?? null;
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
