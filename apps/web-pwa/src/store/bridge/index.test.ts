import { describe, expect, it } from 'vitest';
import {
  generateBriefDocId,
  generateProposalScaffoldId,
  generateTalkingPointsId,
  generateElevationArtifacts,
  isElevationEnabled,
  checkNominationBudget,
  executeNomination,
} from './index';

describe('bridge barrel re-exports', () => {
  it('exports all elevation artifact generators', () => {
    expect(typeof generateBriefDocId).toBe('function');
    expect(typeof generateProposalScaffoldId).toBe('function');
    expect(typeof generateTalkingPointsId).toBe('function');
    expect(typeof generateElevationArtifacts).toBe('function');
  });

  it('exports all nomination flow functions', () => {
    expect(typeof isElevationEnabled).toBe('function');
    expect(typeof checkNominationBudget).toBe('function');
    expect(typeof executeNomination).toBe('function');
  });
});
