import React from 'react';
import { useIdentity } from '../../../hooks/useIdentity';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const TrustGate: React.FC<Props> = ({ children, fallback }) => {
  const { identity } = useIdentity();
  const trustScore = identity?.session?.trustScore ?? 0;
  if (trustScore < 0.5) {
    return (
      <>
        {fallback ?? <p className="text-xs text-amber-600">Verify identity to participate.</p>}
      </>
    );
  }
  return <>{children}</>;
};
