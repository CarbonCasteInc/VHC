import {
  NormalizedItemSchema,
  StoryBundleSchema,
  StorylineGroupSchema,
  type NormalizedItem,
  type StoryBundle,
  type StoryClusterBatchResult,
  type StorylineGroup,
} from './newsTypes';

export interface ClusterEngine<TInput, TOutput> {
  readonly engineId: string;
  clusterBatch(input: TInput): TOutput[] | Promise<TOutput[]>;
}

export interface StoryClusterBatchInput {
  readonly topicId: string;
  readonly items: NormalizedItem[];
}

export interface StoryClusterRemoteEngineOptions {
  endpointUrl: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface StoryClusterBatchCapableEngine
  extends ClusterEngine<StoryClusterBatchInput, StoryBundle> {
  clusterStoryBatch?(
    input: StoryClusterBatchInput,
  ): StoryClusterBatchResult | Promise<StoryClusterBatchResult>;
}

export interface AutoEngineOptions<TInput, TOutput> {
  heuristic: ClusterEngine<TInput, TOutput>;
  remote?: ClusterEngine<TInput, TOutput>;
  preferRemote?: boolean;
  onRemoteFailure?: (error: unknown) => void;
}

const DEFAULT_REMOTE_TIMEOUT_MS = 90_000;

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function readEnvVar(name: string): string | undefined {
  const viteValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  const processValue =
    typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[name] : undefined;
  const value = viteValue ?? processValue;
  return typeof value === 'string' ? value : undefined;
}

function normalizeRemoteTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return DEFAULT_REMOTE_TIMEOUT_MS;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive finite number');
  }
  return Math.floor(timeoutMs);
}

function traceEnabled(): boolean {
  const raw = readEnvVar('VH_STORYCLUSTER_TRACE')?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function traceLog(event: string, detail: Record<string, unknown>): void {
  if (!traceEnabled()) {
    return;
  }
  console.info(`[vh:storycluster-remote] ${event}`, detail);
}

function parseRemoteBundles(payload: unknown): StoryBundle[] {
  return parseRemoteBatchResult(payload).bundles;
}

function parseRemoteStorylines(payload: unknown): StorylineGroup[] {
  return parseRemoteBatchResult(payload).storylines;
}

function parseRemoteBatchResult(payload: unknown): StoryClusterBatchResult {
  const bundles =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { bundles?: unknown }).bundles)
        ? (payload as { bundles: unknown[] }).bundles
        : null;

  if (!bundles) {
    throw new Error('remote cluster response must be an array or an object with bundles[]');
  }

  const storylines =
    payload && typeof payload === 'object' && Array.isArray((payload as { storylines?: unknown }).storylines)
      ? (payload as { storylines: unknown[] }).storylines
      : [];

  return {
    bundles: bundles.map((bundle) => StoryBundleSchema.parse(bundle)),
    storylines: storylines.map((storyline) => StorylineGroupSchema.parse(storyline)),
  };
}

async function describeRemoteFailure(response: Response): Promise<string> {
  const bodyText = (await response.text()).trim();
  if (!bodyText) {
    return `remote cluster request failed: HTTP ${response.status}`;
  }

  const truncated =
    bodyText.length > 500 ? `${bodyText.slice(0, 500)}...` : bodyText;
  return `remote cluster request failed: HTTP ${response.status} - ${truncated}`;
}

function normalizeStoryClusterInput(input: StoryClusterBatchInput): StoryClusterBatchInput {
  const topicId = input.topicId.trim();
  if (!topicId) {
    throw new Error('topicId must be non-empty');
  }

  return {
    topicId,
    items: input.items.map((item) => NormalizedItemSchema.parse(item)),
  };
}

export async function runClusterBatch<TInput, TOutput>(
  engine: ClusterEngine<TInput, TOutput>,
  input: TInput,
): Promise<TOutput[]> {
  const result = engine.clusterBatch(input);
  return isPromiseLike<TOutput[]>(result) ? await result : result;
}

export function runClusterBatchSync<TInput, TOutput>(
  engine: ClusterEngine<TInput, TOutput>,
  input: TInput,
): TOutput[] {
  const result = engine.clusterBatch(input);

  if (isPromiseLike<TOutput[]>(result)) {
    throw new Error(`ClusterEngine "${engine.engineId}" is async and cannot be used in a sync path`);
  }

  return result;
}

export class HeuristicClusterEngine<TInput, TOutput>
  implements ClusterEngine<TInput, TOutput>
{
  constructor(
    private readonly clusterer: (input: TInput) => TOutput[] | Promise<TOutput[]>,
    public readonly engineId: string = 'heuristic-cluster-engine',
  ) {}

  clusterBatch(input: TInput): TOutput[] | Promise<TOutput[]> {
    return this.clusterer(input);
  }
}

export class StoryClusterRemoteEngine
  implements StoryClusterBatchCapableEngine
{
  public readonly engineId = 'storycluster-remote-engine';

  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  constructor(options: StoryClusterRemoteEngineOptions) {
    const endpointUrl = options.endpointUrl.trim();
    if (!endpointUrl) {
      throw new Error('endpointUrl must be non-empty');
    }

    const defaultFetch =
      options.fetchFn ??
      (typeof fetch === 'function'
        ? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
        : undefined);

    if (!defaultFetch) {
      throw new Error('fetch API is unavailable; provide fetchFn');
    }

    this.endpointUrl = endpointUrl;
    this.timeoutMs = normalizeRemoteTimeoutMs(options.timeoutMs);
    this.headers = options.headers ?? {};
    this.fetchFn = defaultFetch;
  }

  async clusterBatch(input: StoryClusterBatchInput): Promise<StoryBundle[]> {
    return (await this.clusterStoryBatch(input)).bundles;
  }

  async clusterStoryBatch(
    input: StoryClusterBatchInput,
  ): Promise<StoryClusterBatchResult> {
    const normalized = normalizeStoryClusterInput(input);
    const controller = new AbortController();
    const startedAtMs = Date.now();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      traceLog('request_started', {
        endpoint_url: this.endpointUrl,
        topic_id: normalized.topicId,
        item_count: normalized.items.length,
        timeout_ms: this.timeoutMs,
      });
      const response = await this.fetchFn(this.endpointUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({
          topic_id: normalized.topicId,
          items: normalized.items,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await describeRemoteFailure(response));
      }

      const payload = await response.json();
      clearTimeout(timer);
      const parsed = parseRemoteBatchResult(payload);
      traceLog('request_completed', {
        endpoint_url: this.endpointUrl,
        topic_id: normalized.topicId,
        item_count: normalized.items.length,
        bundle_count: parsed.bundles.length,
        storyline_count: parsed.storylines.length,
        duration_ms: Math.max(0, Date.now() - startedAtMs),
      });
      return parsed;
    } catch (error) {
      clearTimeout(timer);
      traceLog('request_failed', {
        endpoint_url: this.endpointUrl,
        topic_id: normalized.topicId,
        item_count: normalized.items.length,
        duration_ms: Math.max(0, Date.now() - startedAtMs),
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`remote cluster request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    }
  }
}

export async function runStoryClusterBatch(
  engine: StoryClusterBatchCapableEngine,
  input: StoryClusterBatchInput,
): Promise<StoryClusterBatchResult> {
  if (typeof engine.clusterStoryBatch === 'function') {
    const result = engine.clusterStoryBatch(input);
    return isPromiseLike<StoryClusterBatchResult>(result) ? await result : result;
  }

  return {
    bundles: await runClusterBatch(engine, input),
    storylines: [],
  };
}

export class AutoEngine<TInput, TOutput>
  implements ClusterEngine<TInput, TOutput>
{
  public readonly engineId = 'storycluster-auto-engine';

  private readonly preferRemote: boolean;

  constructor(private readonly options: AutoEngineOptions<TInput, TOutput>) {
    this.preferRemote = options.preferRemote ?? true;
  }

  clusterBatch(input: TInput): TOutput[] | Promise<TOutput[]> {
    const remote = this.options.remote;
    const heuristic = this.options.heuristic;

    if (!this.preferRemote || !remote) {
      return heuristic.clusterBatch(input);
    }

    try {
      const remoteResult = remote.clusterBatch(input);
      if (!isPromiseLike<TOutput[]>(remoteResult)) {
        return remoteResult;
      }
      return remoteResult.catch((error) => this.fallback(input, error));
    } catch (error) {
      return this.fallback(input, error);
    }
  }

  private fallback(input: TInput, error: unknown): TOutput[] | Promise<TOutput[]> {
    this.options.onRemoteFailure?.(error);
    return this.options.heuristic.clusterBatch(input);
  }
}

export function readStoryClusterRemoteEndpoint(): string | undefined {
  const value =
    readEnvVar('VITE_STORYCLUSTER_REMOTE_URL') ??
    readEnvVar('STORYCLUSTER_REMOTE_URL') ??
    readEnvVar('VH_STORYCLUSTER_REMOTE_URL');

  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const clusterEngineInternal = {
  describeRemoteFailure,
  isPromiseLike,
  normalizeRemoteTimeoutMs,
  normalizeStoryClusterInput,
  parseRemoteBatchResult,
  parseRemoteBundles,
  parseRemoteStorylines,
};
