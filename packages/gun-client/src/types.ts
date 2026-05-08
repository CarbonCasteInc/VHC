import type { IGunInstance } from 'gun';
import type { ChainWithGet } from './chain';
import type { StorageAdapter } from './storage/types';
import type { HydrationBarrier } from './sync/barrier';
import type { SystemWriterPin, SystemWriterSignHook, SystemWriterVerifyHook } from './systemWriter';
import type { TopologyGuard } from './topology';

export interface VennClientConfig {
  peers?: string[];
  storage?: StorageAdapter;
  requireSession?: boolean;
  topologyGuard?: TopologyGuard;
  gunLocalStorage?: boolean;
  gunRadisk?: boolean;
  gunFile?: string | false;
  systemWriterPin?: SystemWriterPin | null;
  systemWriterVerify?: SystemWriterVerifyHook;
  systemWriterSign?: SystemWriterSignHook;
  systemWriterId?: string;
  systemWriterNow?: () => number;
}

export interface Namespace<T = unknown> {
  read(): Promise<T | null>;
  write(value: T): Promise<void>;
}

export interface VennClientScopes {
  user: Namespace<Record<string, unknown>>;
  chat: Namespace<Record<string, unknown>>;
  outbox: Namespace<Record<string, unknown>>;
}

export interface VennClient {
  config: VennClientConfig & { peers: string[] };
  hydrationBarrier: HydrationBarrier;
  storage: StorageAdapter;
  topologyGuard: TopologyGuard;
  gun: IGunInstance;
  user: Namespace<Record<string, unknown>>;
  chat: Namespace<Record<string, unknown>>;
  outbox: Namespace<Record<string, unknown>>;
  mesh: ChainWithGet<Record<string, unknown>>;
  sessionReady: boolean;
  markSessionReady(): void;
  linkDevice(deviceKey: string): Promise<void>;
  shutdown(): Promise<void>;
}
