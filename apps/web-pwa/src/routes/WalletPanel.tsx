import React, { useMemo } from 'react';
import { Button } from '@vh/ui';
import { useWallet } from '../hooks/useWallet';

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
    claimStatus,
    connect: connectWallet,
    refresh: refreshWallet,
    claimUBE,
    loading: walletLoading,
    claiming: claimingUBE,
    error: walletError
  } = useWallet();

  const nextClaimLabel = useMemo(() => formatNextClaimLabel(claimStatus), [claimStatus]);
  const trustLabel = useMemo(() => {
    if (!claimStatus) return '-';
    return (claimStatus.trustScore / 100).toFixed(1);
  }, [claimStatus]);

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
          <p className="text-lg font-semibold text-slate-900">{formattedBalance ?? '-'} RVU</p>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Trust Score</p>
          <p className="text-lg font-semibold text-slate-900">
            {trustLabel === '-' ? '-' : `${trustLabel}%`}
          </p>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">UBE Status</p>
          <p className="text-lg font-semibold text-slate-900">{nextClaimLabel}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void claimUBE()} disabled={!claimStatus?.eligible || claimingUBE || walletLoading}>
          {claimingUBE ? 'Claiming…' : 'Claim UBE'}
        </Button>
        {walletError && <span className="text-xs text-red-700">{walletError}</span>}
      </div>
    </div>
  );
};
