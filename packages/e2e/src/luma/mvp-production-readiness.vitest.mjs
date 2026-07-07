import { describe, expect, it } from 'vitest';

import {
  evaluateEvidenceCommitCompatibility,
  meshPublicWssProofStatus,
  resolveCommandInvocation,
  validateActionPolicySurface,
  validateEmbeddedMeshLumaCoverage,
  validateReleaseClaimSurface,
  validateRuntimeProfileSurface,
} from './mvp-production-readiness.mjs';

describe('LUMA MVP production-readiness static checks', () => {
  it('keeps public-beta runtime profile hardening explicit', () => {
    expect(validateRuntimeProfileSurface()).toMatchObject({
      id: 'runtime_profile_public_beta',
      status: 'pass',
    });
  });

  it('routes MVP public write actions through the centralized policy helper', () => {
    expect(validateActionPolicySurface()).toMatchObject({
      id: 'mvp_action_policy',
      status: 'pass',
    });
  });

  it('keeps release-facing surfaces inside beta-local claim boundaries', () => {
    expect(validateReleaseClaimSurface()).toMatchObject({
      id: 'release_claim_boundaries',
      status: 'pass',
    });
  });

  it('runs child pnpm guards through the repo-pinned Corepack package manager', () => {
    expect(resolveCommandInvocation('pnpm check:public-beta-compliance')).toEqual([
      'corepack',
      ['pnpm@9.7.1', 'check:public-beta-compliance'],
    ]);
    expect(resolveCommandInvocation(['git', ['status', '--short']])).toEqual([
      'git',
      ['status', '--short'],
    ]);
  });

  it('accepts skipped synthetic mesh rows when explicit LUMA coverage is embedded and passing', () => {
    const currentCommit = 'abc123';
    const requiredRows = [
      'forum_thread',
      'forum_comment',
      'vote_or_aggregate',
      'directory_publish',
      'news_report_status',
    ].map((writeClass) => ({
      write_class: writeClass,
      status: 'pass',
      writer_kind: 'luma',
      reader_path: 'luma_reader_path',
      schema_epoch: 'post_luma_m0b',
      luma_profile: 'e2e',
      source_gate: 'luma_gated_write_coverage',
    }));
    expect(validateEmbeddedMeshLumaCoverage({
      luma_gated_write_coverage: {
        status: 'pass',
        source_commit: currentCommit,
        source_dirty: false,
        schema_epoch: 'post_luma_m0b',
        luma_profile: 'e2e',
        required_write_classes: requiredRows,
      },
    }, {
      currentCommit,
      coverageValidation: { ok: true },
      lumaRows: [
        {
          write_class: 'LUMA-gated public mesh writes',
          status: 'skipped',
          source_gate: 'topology',
        },
        ...requiredRows,
        {
          write_class: 'LUMA-gated production write classes through LUMA reader path',
          status: 'pass',
        },
      ],
    })).toEqual([]);
  });

  it('blocks when the mesh aggregate does not embed the explicit LUMA coverage rows', () => {
    expect(validateEmbeddedMeshLumaCoverage({
      luma_gated_write_coverage: {
        status: 'pass',
        source_commit: 'abc123',
        source_dirty: false,
        schema_epoch: 'post_luma_m0b',
        luma_profile: 'e2e',
        required_write_classes: [],
      },
    }, {
      currentCommit: 'abc123',
      coverageValidation: { ok: true },
      lumaRows: [],
    })).toContain('mesh readiness embedded LUMA coverage missing passing forum_thread');
  });

  it('accepts parent evidence when the intervening diff is only the committed Mesh evidence packet', () => {
    const git = (args) => {
      const command = args.join(' ');
      if (command === 'rev-list --parents -n 1 evidence456') return 'evidence456 source123';
      if (command === 'merge-base source123 evidence456') return 'source123';
      if (command === 'diff --name-only source123 evidence456') {
        return [
          'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-20260512T011728Z-65cf1cfa/mesh-production-readiness-report.json',
          'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-20260512T011728Z-65cf1cfa/supporting-evidence/luma-gated-write-coverage/mesh-luma-gated-write-coverage-report.json',
        ].join('\n');
      }
      return '';
    };

    expect(evaluateEvidenceCommitCompatibility({
      evidenceCommit: 'source123',
      currentCommit: 'evidence456',
      git,
    })).toMatchObject({
      ok: true,
      accepted_via: 'committed_evidence_packet_from_parent',
    });
  });

  it('accepts ancestor evidence when intervening changes are limited to Mesh readiness contract maintenance', () => {
    const git = (args) => {
      const command = args.join(' ');
      if (command === 'rev-list --parents -n 1 final789') return 'final789 canary456';
      if (command === 'merge-base source123 final789') return 'source123';
      if (command === 'diff --name-only source123 final789') {
        return [
          'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-previous/mesh-production-readiness-report.json',
          'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-current/mesh-production-readiness-report.json',
          'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-current/supporting-evidence/luma-gated-write-coverage/mesh-luma-gated-write-coverage-report.json',
          'docs/specs/spec-mesh-production-readiness.md',
          'packages/e2e/src/live/production-app-canary.mjs',
          'packages/e2e/src/live/production-app-canary.vitest.mjs',
          'packages/e2e/src/luma/mvp-production-readiness.mjs',
          'packages/e2e/src/luma/mvp-production-readiness.vitest.mjs',
          'packages/e2e/src/mesh/evidence-scrub-check.mjs',
          'packages/e2e/src/mesh/production-readiness-check.mjs',
          'packages/e2e/src/mesh/sample-floor-contract.mjs',
        ].join('\n');
      }
      return '';
    };

    expect(evaluateEvidenceCommitCompatibility({
      evidenceCommit: 'source123',
      currentCommit: 'final789',
      git,
    })).toMatchObject({
      ok: true,
      accepted_via: 'committed_evidence_packet_from_ancestor',
    });
  });

  it('rejects parent evidence when the intervening diff touches runtime or LUMA surfaces', () => {
    const git = (args) => {
      const command = args.join(' ');
      if (command === 'rev-list --parents -n 1 runtime456') return 'runtime456 source123';
      if (command === 'merge-base source123 runtime456') return 'source123';
      if (command === 'diff --name-only source123 runtime456') {
        return [
          'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-20260512T011728Z-65cf1cfa/mesh-production-readiness-report.json',
          'apps/web-pwa/src/store/lumaSession.ts',
        ].join('\n');
      }
      return '';
    };

    expect(evaluateEvidenceCommitCompatibility({
      evidenceCommit: 'source123',
      currentCommit: 'runtime456',
      git,
    })).toMatchObject({
      ok: false,
      accepted_via: null,
    });
  });

  it('accepts public WSS proof from the aggregate deployed_wss source report', () => {
    expect(meshPublicWssProofStatus({}, {
      deployedWssSourceReport: {
        run_id: 'mesh-public-wss-proof-1',
        run: {
          deployment_scope: 'public_wss_deployment',
        },
        public_wss_proof: {
          status: 'pass',
        },
      },
    })).toMatchObject({
      ok: true,
      status: 'pass',
      source: 'deployed_wss_source_report',
      run_id: 'mesh-public-wss-proof-1',
    });
  });
});
