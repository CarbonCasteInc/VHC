import React from 'react';
import { TRUST_MINIMUM } from '@vh/data-model';
import { useIdentity } from '../../../hooks/useIdentity';
import { getPublishedIdentity } from '../../../store/identityProvider';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const TrustGate: React.FC<Props> = ({ children, fallback }) => {
  const { identity } = useIdentity();
  const publishedIdentity = identity ? null : getPublishedIdentity();
  const trustScore = identity?.session?.trustScore ?? publishedIdentity?.session?.trustScore ?? 0;
  if (trustScore < TRUST_MINIMUM) {
    return (
      <>
        {fallback ?? (
          <p className="text-xs text-amber-600" data-testid="trust-gate-msg">
            Verify identity to participate.
          </p>
        )}
      </>
    );
  }
  return <>{children}</>;
};
