import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildFixtureCandidateIntake,
  writeFixtureCandidateIntake,
} from './daemon-feed-fixture-candidate-intake.mjs';

describe('fixture candidate intake', () => {
  it('materializes replay and scout candidates into a formal intake artifact', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-fixture-intake-'));
    try {
      const soakDir = path.join(repoRoot, '.tmp', 'daemon-feed-semantic-soak', '100');
      mkdirSync(soakDir, { recursive: true });
      writeFileSync(path.join(soakDir, 'semantic-soak-summary.json'), JSON.stringify({
        readinessStatus: 'not_ready',
        strictSoakPass: true,
      }), 'utf8');
      writeFileSync(path.join(soakDir, 'semantic-soak-trend.json'), JSON.stringify({}), 'utf8');
      writeFileSync(path.join(soakDir, 'release-artifact-index.json'), JSON.stringify({}), 'utf8');
      writeFileSync(path.join(soakDir, 'offline-cluster-replay-report.json'), JSON.stringify({
        currentExecution: {
          calibration: {
            remoteMismatchSamples: [{
              storyId: 'story-1',
              headline: 'Remote story',
              sourceEventKeys: ['guardian-us::1'],
              bestOverlapScore: 0.5,
              bestMatchStoryId: 'story-2',
              bestMatchHeadline: 'Offline story',
              bestMatchSourceEventKeys: ['ap-topnews::2'],
            }],
            offlineMismatchSamples: [],
          },
        },
      }), 'utf8');

      const scoutDir = path.join(repoRoot, 'services', 'news-aggregator', '.tmp', 'news-source-scout', '200');
      mkdirSync(scoutDir, { recursive: true });
      writeFileSync(path.join(scoutDir, 'source-candidate-scout-report.json'), JSON.stringify({
        candidates: [{
          sourceId: 'ap-politics',
          sourceName: 'Associated Press Politics',
          contributionStatus: 'corroborated',
          candidateDecision: 'keep',
          scoutRecommendedAction: 'hold_for_surface_recovery',
          blockingReasons: ['surface_review'],
          candidateOnlyReportPath: '/tmp/candidate-only.json',
          starterPlusCandidateReportPath: '/tmp/starter-plus-candidate.json',
        }],
      }), 'utf8');

      const intake = buildFixtureCandidateIntake({ repoRoot });
      expect(intake.candidates).toHaveLength(2);
      expect(intake.candidates[0]).toMatchObject({
        origin: 'offline_replay_remote_mismatch',
        headline: 'Remote story',
      });
      expect(intake.candidates[1]).toMatchObject({
        origin: 'source_candidate_scout',
        sourceId: 'ap-politics',
      });

      const paths = writeFixtureCandidateIntake({
        outputRoot: path.join(repoRoot, '.tmp', 'findings-executor'),
        value: intake,
      });
      const latest = JSON.parse(readFileSync(paths.latestPath, 'utf8'));
      expect(latest.schemaVersion).toBe('storycluster-fixture-candidate-intake-v1');
      expect(latest.candidates).toHaveLength(2);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
