import React, { useMemo, useState, useEffect } from 'react';
import { Button } from '@vh/ui';
import { useWallet } from '../hooks/useWallet';
import { useIdentity } from '../hooks/useIdentity';
import { useXpLedger } from '../hooks/useXpLedger';

function shortAddress(address: string | null) {
  if (!address) return 'Wallet not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatNextClaimLabel(claimStatus: ReturnType<typeof useWallet>['claimStatus']) {
  if (!claimStatus) return 'No attestation yet';
  if (claimStatus.eligible) return 'Ready to claim';
  if (!claimStatus.nextClaimAt) return 'Pending attestation';
  const deltaMs = claimStatus.nextClaimAt * 1000 - Date.now();
  if (deltaMs <= 0) return 'Ready to claim';
  const minutes = Math.ceil(deltaMs / 60000);
  if (minutes >= 120) {
    return `in ${Math.ceil(minutes / 60)}h`;
  }
  if (minutes >= 60) {
    return 'in 1h';
  }
  return `in ${minutes}m`;
}

export const WalletPanel: React.FC = () => {
  const {
    account,
    formattedBalance,
    balance,
    claimStatus,
    connect: connectWallet,
    refresh: refreshWallet,
    claimUBE,
    loading: walletLoading,
    claiming: claimingUBE,
    error: walletError
  } = useWallet();
  const { identity } = useIdentity();
  const { tracks, totalXP } = useXpLedger();
  const [localNextClaimAt, setLocalNextClaimAt] = useState<number>(0);
  const [localBalanceDelta, setLocalBalanceDelta] = useState<bigint>(0n);

  // Persist local cooldown per device to avoid accidental spam
  useEffect(() => {
    const stored = localStorage.getItem('vh_local_boost_next');
    if (stored) {
      const ts = Number(stored);
      if (!Number.isNaN(ts)) {
        setLocalNextClaimAt(ts);
      }
    }
  }, []);

  useEffect(() => {
    if (localNextClaimAt) {
      localStorage.setItem('vh_local_boost_next', String(localNextClaimAt));
    }
  }, [localNextClaimAt]);

  const trustScoreFloat =
    identity?.session?.trustScore ??
    (identity?.session?.scaledTrustScore != null ? identity.session.scaledTrustScore / 10000 : undefined);
  const eligibleLocal =
    trustScoreFloat != null && trustScoreFloat >= 0.5 && (localNextClaimAt === 0 || localNextClaimAt * 1000 <= Date.now());
  const nextClaimLabel = useMemo(() => formatNextClaimLabel(claimStatus), [claimStatus]);
  // Prefer local identity trust score, fallback to wallet/chain trust score
  const trustLabel = useMemo(() => {
    if (identity?.session?.scaledTrustScore != null) {
      return (identity.session.scaledTrustScore / 100).toFixed(1);
    }
    if (!claimStatus) return '-';
    return (claimStatus.trustScore / 100).toFixed(1);
  }, [identity, claimStatus]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Wallet</p>
          <p className="text-xs text-slate-600">{shortAddress(account)}</p>
        </div>
        <div className="flex gap-2">
          {!account && (
            <Button onClick={() => void connectWallet()} disabled={walletLoading}>
              Connect Wallet
            </Button>
          )}
          <Button variant="ghost" onClick={() => void refreshWallet()} disabled={walletLoading || !account}>
            {walletLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">RVU Balance</p>
          <p className="text-lg font-semibold text-slate-900">
            {formattedBalance ?? '-'}
            {localBalanceDelta > 0n && (
              <span className="ml-1 text-xs text-emerald-700">(+{Number(localBalanceDelta) / 1e18} mock)</span>
            )}{' '}
            RVU
          </p>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Trust Score</p>
          <p className="text-lg font-semibold text-slate-900" data-testid="wallet-trust-score">
            {trustLabel === '-' ? '-' : `${trustLabel}%`}
          </p>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Daily Boost</p>
          <p className="text-lg font-semibold text-slate-900">{nextClaimLabel}</p>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">XP Breakdown</p>
        <div className="mt-1 grid grid-cols-4 gap-2 text-sm">
          <div>
            <p className="text-xs text-slate-500">Civic</p>
            <p className="font-semibold text-slate-900" data-testid="xp-civic">{tracks.civic}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Social</p>
            <p className="font-semibold text-slate-900" data-testid="xp-social">{tracks.social}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Project</p>
            <p className="font-semibold text-slate-900" data-testid="xp-project">{tracks.project}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total</p>
            <p className="font-semibold text-slate-900" data-testid="xp-total">{totalXP}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={() => {
            if (!claimStatus?.eligible && !eligibleLocal) return;
            void (async () => {
              if (claimStatus?.eligible) {
                await claimUBE();
              }
              if (trustScoreFloat != null) {
                const rvMinted = useXpLedger.getState().claimDailyBoost(trustScoreFloat);
                const now = Math.floor(Date.now() / 1000);
                setLocalNextClaimAt(now + 24 * 60 * 60);
                if (claimStatus?.eligible !== true) {
                  setLocalBalanceDelta((prev) => prev + BigInt(rvMinted) * 10n ** 18n);
                }
              }
            })();
          }}
          disabled={(!claimStatus?.eligible && !eligibleLocal) || claimingUBE || walletLoading}
        >
          {claimingUBE ? 'Claiming…' : claimStatus?.eligible || eligibleLocal ? 'Daily Boost' : 'Come back tomorrow'}
        </Button>
        {walletError && <span className="text-xs text-red-700">{walletError}</span>}
      </div>
    </div>
  );
};
