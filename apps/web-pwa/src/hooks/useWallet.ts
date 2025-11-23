import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import { isE2EMode } from '../store';

const RGU_ABI = ['function balanceOf(address account) view returns (uint256)'];
const UBE_ABI = [
  'function claim() external',
  'function getClaimStatus(address user) view returns (bool eligible,uint256 nextClaimAt,uint256 trustScore,uint256 expiresAt,bytes32 nullifier)'
];

/* v8 ignore next */
const ENV = (import.meta as any).env ?? {};
const FALLBACK_ENV = (globalThis as any).process?.env || {};
/* istanbul ignore next */
function resolveEnv(value?: string) {
  return value && value.length > 0 ? value : undefined;
}

const RPC_URL = resolveEnv(ENV.VITE_RPC_URL) ?? resolveEnv(FALLBACK_ENV?.VITE_RPC_URL) ?? 'http://localhost:8545';
const UBE_ADDRESS = resolveEnv(ENV.VITE_UBE_ADDRESS) ?? resolveEnv(FALLBACK_ENV?.VITE_UBE_ADDRESS) ?? '';
const RGU_ADDRESS = resolveEnv(ENV.VITE_RGU_ADDRESS) ?? resolveEnv(FALLBACK_ENV?.VITE_RGU_ADDRESS) ?? '';
const MOCK_NULLIFIER = '0x6d6f636b2d6e756c6c69666965720000000000000000000000000000000000';

let testSetAccount: ((value: string | null) => void) | null = null;
let testSetProvider: ((provider: BrowserProvider | null) => void) | null = null;
let testSetBalance: ((value: bigint | null) => void) | null = null;

interface ClaimStatus {
  eligible: boolean;
  nextClaimAt: number;
  trustScore: number;
  expiresAt: number;
  nullifier: string;
}

export function useWallet() {
  const e2e = isE2EMode();
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [mockNextClaim, setMockNextClaim] = useState<number>(0);

  if (process.env.NODE_ENV === 'test') {
    testSetAccount = setAccount;
    testSetProvider = setProvider;
    testSetBalance = setBalance;
  }

  const hasConfig = useMemo(() => Boolean(UBE_ADDRESS && RGU_ADDRESS), []);

  const connect = useCallback(async () => {
    if (e2e) {
      const now = Math.floor(Date.now() / 1000);
      setAccount('0xE2E0000000000000000000000000000000000000');
      setBalance(parseUnits('250', 18));
      setClaimStatus({
        eligible: true,
        nextClaimAt: now,
        trustScore: 9500,
        expiresAt: now + 7 * 24 * 60 * 60,
        nullifier: MOCK_NULLIFIER
      });
      setError(null);
      return;
    }
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      setError('No wallet provider detected');
      return;
    }
    try {
      const browserProvider = new BrowserProvider((window as any).ethereum);
      const [address] = await browserProvider.send('eth_requestAccounts', []);
      setProvider(browserProvider);
      setAccount(address);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [e2e]);

  const refresh = useCallback(async () => {
    if (e2e) {
      return;
    }
    if (!hasConfig) {
      setError('Missing contract addresses for wallet integration');
      return;
    }
    if (!account) return;
    setLoading(true);
    try {
      const readProvider = provider ?? new JsonRpcProvider(RPC_URL);
      const rgu = new Contract(RGU_ADDRESS, RGU_ABI, readProvider);
      const rawBalance = (await rgu.balanceOf(account)) as bigint;
      setBalance(rawBalance);

      const ube = new Contract(UBE_ADDRESS, UBE_ABI, readProvider);
      const status = (await ube.getClaimStatus(account)) as [
        boolean,
        bigint,
        bigint,
        bigint,
        string
      ];
      setClaimStatus({
        eligible: status[0],
        nextClaimAt: Number(status[1]),
        trustScore: Number(status[2]),
        expiresAt: Number(status[3]),
        nullifier: status[4]
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account, e2e, hasConfig, provider]);

  const claimUBE = useCallback(async () => {
    if (e2e) {
      const now = Math.floor(Date.now() / 1000);
      if (mockNextClaim && now < mockNextClaim) {
        setError('Claim cooldown active');
        return;
      }
      const updatedNext = now + 24 * 60 * 60;
      setMockNextClaim(updatedNext);
      setBalance((prev) => (prev ?? 0n) + parseUnits('25', 18));
      setClaimStatus({
        eligible: false,
        nextClaimAt: updatedNext,
        trustScore: 9500,
        expiresAt: now + 7 * 24 * 60 * 60,
        nullifier: MOCK_NULLIFIER
      });
      setError(null);
      return;
    }
    if (!hasConfig) {
      setError('Missing contract addresses for wallet integration');
      return;
    }
    if (!provider) {
      setError('Connect wallet to claim UBE');
      return;
    }
    setClaiming(true);
    try {
      const signer = await provider.getSigner();
      const ube = new Contract(UBE_ADDRESS, UBE_ABI, signer);
      const tx = await ube.claim();
      await tx.wait();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  }, [e2e, hasConfig, mockNextClaim, provider, refresh]);

  useEffect(() => {
    if (e2e && !account) {
      void connect();
    }
  }, [account, connect, e2e]);

  useEffect(() => {
    if (provider && account) {
      void refresh();
    }
  }, [account, provider, refresh]);

  const formattedBalance = useMemo(() => {
    if (balance === null) return null;
    const value = Number.parseFloat(formatUnits(balance, 18));
    if (Number.isNaN(value)) return formatUnits(balance, 18);
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }, [balance]);

  return {
    account,
    balance,
    formattedBalance,
    claimStatus,
    loading,
    claiming,
    error,
    connect,
    refresh,
    claimUBE
  };
}

export const __walletTest = {
  setAccount(value: string | null) {
    testSetAccount?.(value);
  },
  setProvider(value: BrowserProvider | null) {
    testSetProvider?.(value);
  },
  setBalance(value: bigint | null) {
    testSetBalance?.(value);
  }
};
