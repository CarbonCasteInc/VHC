import { describe, expect, it } from 'vitest';
import {
  RepresentativeSchema,
  RepresentativeDirectorySchema,
} from './bridgeRepresentative';

const validRep = {
  id: 'us-house-ca-11',
  name: 'Jane Doe',
  title: 'Representative',
  office: 'house' as const,
  country: 'US',
  state: 'CA',
  district: '11',
  districtHash: 'abc123hash',
  contactMethod: 'email' as const,
  email: 'jane@house.gov',
  lastVerified: 1_700_000_000_000,
};

const validDirectory = {
  version: '1.0.0',
  lastUpdated: 1_700_000_000_000,
  updateSource: 'bundled-v1',
  representatives: [validRep],
  byState: { CA: ['us-house-ca-11'] },
  byDistrictHash: { abc123hash: ['us-house-ca-11'] },
};

describe('RepresentativeSchema', () => {
  it('parses a valid representative', () => {
    const result = RepresentativeSchema.safeParse(validRep);
    expect(result.success).toBe(true);
  });

  it('parses with all optional fields', () => {
    const full = {
      ...validRep,
      party: 'Independent',
      contactUrl: 'https://house.gov/contact',
      phone: '+12025551234',
      website: 'https://janedoe.house.gov',
      photoUrl: 'https://house.gov/photo.jpg',
      socialHandles: { x: '@janedoe' },
    };
    const result = RepresentativeSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('parses without optional fields', () => {
    const minimal = {
      id: 'local-1',
      name: 'John Smith',
      title: 'Councilmember',
      office: 'local' as const,
      country: 'US',
      districtHash: 'hash1',
      contactMethod: 'manual' as const,
      lastVerified: Date.now(),
    };
    const result = RepresentativeSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('accepts all office values', () => {
    for (const office of ['senate', 'house', 'state', 'local'] as const) {
      const result = RepresentativeSchema.safeParse({ ...validRep, office });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all contactMethod values', () => {
    for (const cm of ['email', 'phone', 'both', 'manual'] as const) {
      const result = RepresentativeSchema.safeParse({ ...validRep, contactMethod: cm });
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown keys (.strict)', () => {
    const result = RepresentativeSchema.safeParse({ ...validRep, extraField: 'no' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid office', () => {
    const result = RepresentativeSchema.safeParse({ ...validRep, office: 'federal' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = RepresentativeSchema.safeParse({ ...validRep, email: 'not-email' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid contactUrl', () => {
    const result = RepresentativeSchema.safeParse({ ...validRep, contactUrl: 'nope' });
    expect(result.success).toBe(false);
  });

  it.each(['id', 'name', 'title', 'office', 'country', 'districtHash', 'contactMethod', 'lastVerified'] as const)(
    'rejects missing required field: %s',
    (field) => {
      const obj = { ...validRep };
      delete (obj as Record<string, unknown>)[field];
      expect(RepresentativeSchema.safeParse(obj).success).toBe(false);
    },
  );
});

describe('RepresentativeDirectorySchema', () => {
  it('parses a valid directory', () => {
    const result = RepresentativeDirectorySchema.safeParse(validDirectory);
    expect(result.success).toBe(true);
  });

  it('parses an empty directory', () => {
    const empty = {
      version: '0.0.1',
      lastUpdated: 0,
      updateSource: 'empty',
      representatives: [],
      byState: {},
      byDistrictHash: {},
    };
    const result = RepresentativeDirectorySchema.safeParse(empty);
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys (.strict)', () => {
    const result = RepresentativeDirectorySchema.safeParse({ ...validDirectory, extra: true });
    expect(result.success).toBe(false);
  });

  it.each(['version', 'lastUpdated', 'updateSource', 'representatives', 'byState', 'byDistrictHash'] as const)(
    'rejects missing required field: %s',
    (field) => {
      const obj = { ...validDirectory };
      delete (obj as Record<string, unknown>)[field];
      expect(RepresentativeDirectorySchema.safeParse(obj).success).toBe(false);
    },
  );

  it('rejects directory with invalid representative entry', () => {
    const bad = { ...validDirectory, representatives: [{ id: 'bad' }] };
    expect(RepresentativeDirectorySchema.safeParse(bad).success).toBe(false);
  });
});
