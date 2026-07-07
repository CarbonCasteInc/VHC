/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AssuranceEnvelope } from '@vh/luma-sdk';
import { RepresentativeSelector } from './RepresentativeSelector';
import type { Representative } from '@vh/data-model';

// A minimal beta-local envelope: scoreFromEnvelope maps assuranceLevel to a
// scalar, so only assuranceLevel matters for the view gate.
const BETA_LOCAL_ENVELOPE = { assuranceLevel: 'beta_local' } as unknown as AssuranceEnvelope;
const NONE_ENVELOPE = { assuranceLevel: 'none' } as unknown as AssuranceEnvelope;

let assuranceEnvelope: AssuranceEnvelope | undefined = BETA_LOCAL_ENVELOPE;
let proofDistrictHash: string | null = 'hash-ca-11';
const onSelectMock = vi.fn();

vi.mock('../../hooks/useIdentity', () => ({
  useIdentity: () => ({ identity: { assuranceEnvelope } }),
}));

vi.mock('../../hooks/useConstituencyProof', () => ({
  useConstituencyProof: () => ({
    proof: proofDistrictHash
      ? { district_hash: proofDistrictHash, nullifier: 'n', merkle_root: 'r' }
      : null,
  }),
}));

vi.mock('../../store/bridge/districtConfig', () => ({
  getConfiguredDistrict: () => 'configured-district',
}));

const mockReps: Representative[] = [
  {
    id: 'us-house-ca-11',
    name: 'Jane Doe',
    title: 'Representative',
    office: 'house',
    country: 'US',
    state: 'CA',
    district: '11',
    districtHash: 'hash-ca-11',
    contactMethod: 'both',
    email: 'jane@house.gov',
    phone: '+12025551234',
    contactUrl: 'https://house.gov/contact',
    lastVerified: 1_700_000_000_000,
    party: 'Independent',
  },
  {
    id: 'us-senate-ca-1',
    name: 'John Smith',
    title: 'Senator',
    office: 'senate',
    country: 'US',
    state: 'CA',
    districtHash: 'hash-ca-s1',
    contactMethod: 'email',
    email: 'john@senate.gov',
    lastVerified: 1_700_000_000_000,
  },
];

// The mock captures the district hash the component passes to findRepresentatives
// and returns reps only for the matching district (byDistrictHash behavior).
let mockRepsByDistrict: Record<string, Representative[]> = { 'hash-ca-11': mockReps };
const findRepresentativesArgs: string[] = [];

vi.mock('../../store/bridge/representativeDirectory', () => ({
  findRepresentatives: (districtHash: string) => {
    findRepresentativesArgs.push(districtHash);
    return mockRepsByDistrict[districtHash] ?? [];
  },
}));

beforeEach(() => {
  assuranceEnvelope = BETA_LOCAL_ENVELOPE;
  proofDistrictHash = 'hash-ca-11';
  mockRepsByDistrict = { 'hash-ca-11': mockReps };
  findRepresentativesArgs.length = 0;
  onSelectMock.mockClear();
});

afterEach(() => cleanup());

describe('RepresentativeSelector', () => {
  it('passes the active proof district hash to findRepresentatives', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(findRepresentativesArgs).toContain('hash-ca-11');
    expect(findRepresentativesArgs).not.toContain('');
  });

  it('falls back to the configured district when no proof is present', () => {
    proofDistrictHash = null;
    mockRepsByDistrict = { 'configured-district': mockReps };
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(findRepresentativesArgs).toContain('configured-district');
  });

  it('shows no matched offices for a wrong/empty district', () => {
    proofDistrictHash = 'wrong-district';
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(findRepresentativesArgs).toContain('wrong-district');
    expect(screen.getByTestId('rep-empty')).toBeInTheDocument();
  });

  it('renders rep cards when the beta-local envelope clears the view gate', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(screen.getByTestId('rep-selector')).toBeInTheDocument();
    expect(screen.getByTestId('rep-card-us-house-ca-11')).toBeInTheDocument();
    expect(screen.getByTestId('rep-card-us-senate-ca-1')).toBeInTheDocument();
  });

  it('shows trust gate when the envelope score is below 0.5 (none/missing)', () => {
    assuranceEnvelope = NONE_ENVELOPE;
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(screen.getByTestId('rep-trust-gate')).toBeInTheDocument();
    expect(screen.getByText(/0\.00/)).toBeInTheDocument();
  });

  it('shows trust gate when there is no assurance envelope at all', () => {
    assuranceEnvelope = undefined;
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(screen.getByTestId('rep-trust-gate')).toBeInTheDocument();
  });

  it('renders rep details: name, title, office, party, district, state', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    const card = screen.getByTestId('rep-card-us-house-ca-11');
    expect(card.textContent).toContain('Representative');
    expect(card.textContent).toContain('house');
    expect(card.textContent).toContain('Independent');
    expect(card.textContent).toContain('District 11');
    expect(card.textContent).toContain('CA');
  });

  it('renders channel badges', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    const card = screen.getByTestId('rep-card-us-house-ca-11');
    expect(card.textContent).toContain('email');
    expect(card.textContent).toContain('phone');
    expect(card.textContent).toContain('web');
  });

  it('shows manual badge when no channels available', () => {
    mockRepsByDistrict = {
      'hash-ca-11': [
        {
          id: 'rep-no-contact',
          name: 'No Contact',
          title: 'Rep',
          office: 'house',
          country: 'US',
          districtHash: 'hash-ca-11',
          contactMethod: 'manual',
          lastVerified: Date.now(),
        },
      ],
    };
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    const card = screen.getByTestId('rep-card-rep-no-contact');
    expect(card.textContent).toContain('manual');
  });

  it('calls onSelect with rep id when clicked', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    fireEvent.click(screen.getByTestId('rep-card-us-house-ca-11'));
    expect(onSelectMock).toHaveBeenCalledWith('us-house-ca-11');
  });

  it('shows empty state when no reps loaded', () => {
    mockRepsByDistrict = {};
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    expect(screen.getByTestId('rep-empty')).toBeInTheDocument();
  });

  it('displays Verified date', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    const card = screen.getByTestId('rep-card-us-house-ca-11');
    expect(card.textContent).toContain('Verified');
  });

  it('omits party when absent', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    const card = screen.getByTestId('rep-card-us-senate-ca-1');
    expect(card.textContent).not.toContain('Independent');
  });

  it('omits district when absent', () => {
    render(<RepresentativeSelector onSelect={onSelectMock} />);
    const card = screen.getByTestId('rep-card-us-senate-ca-1');
    expect(card.textContent).not.toContain('District');
  });
});
