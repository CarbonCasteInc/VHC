/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { parseUnits } from 'ethers';
import '@testing-library/jest-dom/vitest';

const storeMock = vi.hoisted(() => ({
  isE2EMode: vi.fn()
}));

vi.mock('../store', () => ({
  isE2EMode: storeMock.isE2EMode
}));

const ethersHoist = vi.hoisted(() => {
  const contract = {
    balanceOf: vi.fn(),
    getClaimStatus: vi.fn(),
    claim: vi.fn()
  };
  const send = vi.fn();
  const getSigner = vi.fn();
  return { contract, send, getSigner };
});

vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  const mocks = ethersHoist;

  class FakeBrowserProvider {
    provider: unknown;
    constructor(provider: unknown) {
      this.provider = provider;
    }
    send = (...args: unknown[]) => mocks.send(...args);
    getSigner = (...args: unknown[]) => mocks.getSigner(...args);
  }

  class FakeJsonRpcProvider {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
  }

  class FakeContract {
    address: string;
    abi: unknown;
    provider: unknown;
    constructor(address: string, abi: unknown, provider: unknown) {
      this.address = address;
      this.abi = abi;
      this.provider = provider;
    }
    balanceOf = (...args: unknown[]) => mocks.contract.balanceOf(...args);
    getClaimStatus = (...args: unknown[]) => mocks.contract.getClaimStatus(...args);
    claim = (...args: unknown[]) => mocks.contract.claim(...args);
  }

  return {
    ...actual,
    BrowserProvider: FakeBrowserProvider,
    JsonRpcProvider: FakeJsonRpcProvider,
    Contract: FakeContract,
    __mocks: mocks
  };
});

type UseWalletHook = typeof import('./useWallet')['useWallet'];

const baseEnv = {
  VITE_UBE_ADDRESS: '0xUBE',
  VITE_RVU_ADDRESS: '0xRVU',
  VITE_RPC_URL: 'http://rpc',
  VITE_E2E_MODE: 'false'
};

interface LoadOptions {
  skipEnv?: boolean;
  processEnv?: Record<string, string>;
  noProcess?: boolean;
}

async function loadHook(envOverrides: Record<string, string>, e2eMode: boolean, options: LoadOptions = {}): Promise<UseWalletHook> {
  vi.resetModules();
  const originalProcess = (globalThis as any).process;
  if (options.noProcess) {
    // @ts-expect-error override for branch coverage
    (globalThis as any).process = undefined;
  }
  const env = options.skipEnv ? { ...envOverrides } : { ...baseEnv, ...envOverrides };
  const processEnv = options.processEnv ?? env;
  const setEnvVar = (key: string, value: string | undefined) => {
    if (!(globalThis as any).process?.env) {
      return;
    }
    if (typeof value === 'undefined') {
      delete ((globalThis as any).process.env as Record<string, string | undefined>)[key];
    } else {
      (globalThis as any).process.env[key] = value;
    }
  };
  setEnvVar('VITE_UBE_ADDRESS', processEnv.VITE_UBE_ADDRESS);
  setEnvVar('VITE_RVU_ADDRESS', processEnv.VITE_RVU_ADDRESS);
  setEnvVar('VITE_RPC_URL', processEnv.VITE_RPC_URL);
  setEnvVar('VITE_E2E_MODE', processEnv.VITE_E2E_MODE);
  if (options.skipEnv) {
    vi.stubGlobal('import.meta', {} as any);
  } else {
    vi.stubGlobal('import.meta', { env });
  }
  storeMock.isE2EMode.mockReturnValue(e2eMode);
  const mod = await import('./useWallet');
  if (options.noProcess) {
    (globalThis as any).process = originalProcess;
  }
  return mod.useWallet;
}

async function getEthersMocks() {
  const mod = await import('ethers');
  // @ts-expect-error __mocks is added in the test mock above
  return mod.__mocks as typeof ethersHoist;
}

async function getWalletTestHelpers() {
  const mod = await import('./useWallet');
  // @ts-expect-error test helpers are injected only in test mode
  return mod.__walletTest as {
    setAccount: (value: string | null) => void;
    setProvider: (value: unknown) => void;
    setBalance: (value: bigint | null) => void;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWallet', () => {
  it('returns mocked balance and status in E2E mode and simulates claim', async () => {
    const useWallet = await loadHook({ VITE_E2E_MODE: 'true' }, true);
    const walletHelpers = await getWalletTestHelpers();
    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.account).toMatch(/^0xE2E/));
    expect(result.current.claimStatus?.eligible).toBe(true);
    expect(result.current.formattedBalance).toBe('250');

    walletHelpers.setBalance(null);
    await act(async () => {
      await result.current.claimUBE();
    });

    expect(result.current.claimStatus?.eligible).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.claimUBE();
    });
    expect(result.current.error).toBe('Claim cooldown active');

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe('Claim cooldown active');
  });

  it('connects, refreshes, and claims using mocked ethers providers', async () => {
    const useWallet = await loadHook({}, false);
    const ethersMocks = await getEthersMocks();
    ethersMocks.send.mockResolvedValue(['0xabc']);
    const futureExpiry = Math.floor(Date.now() / 1000) + 86400;
    ethersMocks.contract.balanceOf.mockResolvedValue(parseUnits('10', 18));
    ethersMocks.contract.getClaimStatus.mockResolvedValue([true, 0n, 9000n, BigInt(futureExpiry), '0xnull']);
    const claimWait = vi.fn().mockResolvedValue({});
    ethersMocks.contract.claim.mockResolvedValue({ wait: claimWait });
    ethersMocks.getSigner.mockResolvedValue({ signer: true });

    Object.defineProperty(window, 'ethereum', { value: { isTest: true }, configurable: true });

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect();
    });
    expect(ethersMocks.send).toHaveBeenCalledWith('eth_requestAccounts', []);
    expect(result.current.account).toBe('0xabc');

    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(ethersMocks.contract.balanceOf).toHaveBeenCalled());
    await waitFor(() => expect(result.current.formattedBalance).toBe('10'));
    await waitFor(() => expect(result.current.claimStatus?.eligible).toBe(true));

    await act(async () => {
      await result.current.claimUBE();
    });
    expect(ethersMocks.contract.claim).toHaveBeenCalled();
    expect(claimWait).toHaveBeenCalled();
    await waitFor(() => expect(result.current.claimStatus?.eligible).toBe(true));
  });

  it('handles connection and refresh errors gracefully', async () => {
    const useWallet = await loadHook({}, false);
    const ethersMocks = await getEthersMocks();
    Object.defineProperty(window, 'ethereum', { value: { ok: true }, configurable: true });
    ethersMocks.send.mockRejectedValue(new Error('connect boom'));

    const { result } = renderHook(() => useWallet());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toBe('connect boom');

    ethersMocks.send.mockResolvedValue(['0xabc']);
    ethersMocks.contract.balanceOf.mockRejectedValue(new Error('read fail'));
    await act(async () => {
      await result.current.connect();
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe('read fail');
  });

  it('no-ops refresh without an account and falls back when provider is missing', async () => {
    const useWallet = await loadHook({}, false);
    const ethersMocks = await getEthersMocks();
    const walletHelpers = await getWalletTestHelpers();

    const { result } = renderHook(() => useWallet());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();

    await act(async () => {
      walletHelpers.setAccount('0xdead');
      walletHelpers.setProvider(null);
    });
    ethersMocks.contract.balanceOf.mockResolvedValue(0n);
    ethersMocks.contract.getClaimStatus.mockResolvedValue([true, 0n, 8000n, BigInt(Math.floor(Date.now() / 1000) + 1000), '0xdead']);
    await act(async () => {
      await result.current.refresh();
    });
    expect(ethersMocks.contract.balanceOf).toHaveBeenCalledWith('0xdead');
  });

  it('uses process env and defaults when import.meta is missing', async () => {
    const useWalletProcessEnv = await loadHook({}, false, {
      skipEnv: true,
      processEnv: {
        VITE_RPC_URL: 'http://fallback-rpc',
        VITE_UBE_ADDRESS: '0xU',
        VITE_RVU_ADDRESS: '0xR',
        VITE_E2E_MODE: 'false'
      }
    });
    const { result: processEnvHook } = renderHook(() => useWalletProcessEnv());
    await act(async () => {
      await processEnvHook.current.refresh();
    });
    expect(processEnvHook.current.error).toBeNull();

    const useWalletDefaultEnv = await loadHook({}, false, { skipEnv: true, processEnv: {} as any });
    const { result: defaultEnvHook } = renderHook(() => useWalletDefaultEnv());
    await act(async () => {
      await defaultEnvHook.current.claimUBE();
    });
    expect(defaultEnvHook.current.error).toContain('Missing contract addresses');
  });

  it('formats balance fallback when parseFloat is NaN', async () => {
    const useWallet = await loadHook({}, false);
    const { formatUnits } = await import('ethers');
    const originalFormatUnits = formatUnits;
    // @ts-expect-error override for test
    (await import('ethers')).formatUnits = () => 'not-a-number';
    const walletHelpers = await getWalletTestHelpers();
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      walletHelpers.setBalance(parseUnits('1', 18));
    });

    await waitFor(() => expect(result.current.formattedBalance).toBe('not-a-number'));
    // @ts-expect-error restore original
    (await import('ethers')).formatUnits = originalFormatUnits;
  });

  it('handles missing process object when resolving env', async () => {
    const useWallet = await loadHook({}, false, { skipEnv: true, processEnv: {}, noProcess: true });
    const { result } = renderHook(() => useWallet());
    await act(async () => {
      await result.current.claimUBE();
    });
    expect(result.current.error).toContain('Missing contract addresses');
  });

  it('surfaces errors when no wallet provider is available', async () => {
    const useWallet = await loadHook({}, false);
    const { result } = renderHook(() => useWallet());
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (window as any).ethereum;
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toContain('No wallet provider');
  });

  it('validates configuration and provider presence before claiming', async () => {
    const useWallet = await loadHook({}, false);
    const { result } = renderHook(() => useWallet());
    await act(async () => {
      await result.current.claimUBE();
    });
    expect(result.current.error).toContain('Connect wallet');

    const useWalletMissingConfig = await loadHook({ VITE_UBE_ADDRESS: '', VITE_RVU_ADDRESS: '' }, false);
    const { result: missingConfig } = renderHook(() => useWalletMissingConfig());
    await act(async () => {
      await missingConfig.current.refresh();
    });
    expect(missingConfig.current.error).toContain('Missing contract addresses');
    await act(async () => {
      await missingConfig.current.claimUBE();
    });
    expect(missingConfig.current.error).toContain('Missing contract addresses');
  });

  it('surfaces contract reverts', async () => {
    const useWallet = await loadHook({}, false);
    const ethersMocks = await getEthersMocks();
    Object.defineProperty(window, 'ethereum', { value: { ok: true }, configurable: true });
    ethersMocks.send.mockResolvedValue(['0xabc']);
    ethersMocks.contract.getClaimStatus.mockResolvedValue([true, 0n, 9000n, BigInt(Math.floor(Date.now() / 1000) + 10), '0xnull']);
    ethersMocks.contract.balanceOf.mockResolvedValue(0n);
    ethersMocks.contract.claim.mockRejectedValue(new Error('revert: deny'));
    ethersMocks.getSigner.mockResolvedValue({ signer: true });

    const { result } = renderHook(() => useWallet());
    await act(async () => {
      await result.current.connect();
    });
    await act(async () => {
      await result.current.claimUBE().catch(() => {});
    });
    expect(result.current.error).toContain('revert: deny');
  });
});
