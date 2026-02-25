import { buildRemoteRequest } from '../../../../packages/ai-engine/src/modelConfig';
import { parseAnalysisResponse, type AnalysisResult } from '../../../../packages/ai-engine/src/schema';
import { buildLegacyVhcArticlePrompt } from './legacyPrompt';

const DEFAULT_ANALYSES_LIMIT = 25;
const DEFAULT_ANALYSES_PER_TOPIC_LIMIT = 5;
const TOPIC_ID_LINE_PATTERN = /^Topic ID:\s*(.+)$/im;
const ARTICLE_DELIMITER = '--- ARTICLE START ---';
const UPSTREAM_EMPTY_CONTENT_RETRIES = 2;

type AnalysisProvider = {
  provider_id: string;
  model_id: string;
  kind: 'remote';
};

interface RelayArticleRequest {
  articleText: string;
  model?: string;
  topicId?: string;
}

interface RelayPromptRequest {
  prompt: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  topicId?: string;
}

interface AnalysisRelayConfig {
  endpointUrl: string;
  apiKey: string;
  providerId: string;
  modelOverride?: string;
  analysesLimit: number;
  analysesPerTopicLimit: number;
}

interface AnalysisBudgetState {
  date: string;
  analyses: number;
  analysesPerTopic: Record<string, number>;
}

const relayBudgetState: AnalysisBudgetState = { date: '', analyses: 0, analysesPerTopic: {} };

export interface AnalysisRelayResult {
  status: number;
  payload: {
    error?: string;
    details?: string;
    content?: string;
    analysis?: AnalysisResult;
    provider?: AnalysisProvider;
    budget?: { analyses: number; analyses_per_topic: number };
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function asTemperature(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 2) {
    return undefined;
  }
  return value;
}

function parseArticleRequest(rawBody: unknown): RelayArticleRequest | null {
  if (!isObject(rawBody)) return null;
  const articleText = asNonEmptyString(rawBody.articleText);
  if (!articleText) return null;
  const model = asNonEmptyString(rawBody.model);
  const topicId = asNonEmptyString(rawBody.topicId);
  const result: RelayArticleRequest = { articleText };
  if (model) result.model = model;
  if (topicId) result.topicId = topicId;
  return result;
}

function parsePromptRequest(rawBody: unknown): RelayPromptRequest | null {
  if (!isObject(rawBody)) return null;
  const prompt = asNonEmptyString(rawBody.prompt);
  if (!prompt) return null;

  const candidate: RelayPromptRequest = { prompt };
  const model = asNonEmptyString(rawBody.model);
  if (model) candidate.model = model;

  if (rawBody.max_tokens !== undefined) {
    const maxTokens = asPositiveInt(rawBody.max_tokens);
    if (maxTokens === undefined) return null;
    candidate.max_tokens = maxTokens;
  }

  if (rawBody.temperature !== undefined) {
    const temperature = asTemperature(rawBody.temperature);
    if (temperature === undefined) return null;
    candidate.temperature = temperature;
  }

  const topicId = asNonEmptyString(rawBody.topicId);
  if (topicId) candidate.topicId = topicId;
  return candidate;
}

function readServerEnvVar(env: Record<string, string | undefined>, name: string): string | undefined {
  return asNonEmptyString(env[name]);
}

function parsePositiveIntString(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveAnalysisRelayConfig(env: Record<string, string | undefined>): AnalysisRelayConfig | null {
  const endpointUrl = readServerEnvVar(env, 'ANALYSIS_RELAY_UPSTREAM_URL');
  const apiKey = readServerEnvVar(env, 'ANALYSIS_RELAY_API_KEY');
  if (!endpointUrl || !apiKey) return null;

  return {
    endpointUrl,
    apiKey,
    providerId: readServerEnvVar(env, 'ANALYSIS_RELAY_PROVIDER_ID') ?? 'remote-analysis-relay',
    modelOverride: readServerEnvVar(env, 'ANALYSIS_RELAY_MODEL'),
    analysesLimit: parsePositiveIntString(readServerEnvVar(env, 'ANALYSIS_RELAY_BUDGET_ANALYSES')) ?? DEFAULT_ANALYSES_LIMIT,
    analysesPerTopicLimit:
      parsePositiveIntString(readServerEnvVar(env, 'ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC')) ??
      DEFAULT_ANALYSES_PER_TOPIC_LIMIT,
  };
}

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function resetBudgetIfNeeded(now: Date): void {
  const date = todayIso(now);
  if (relayBudgetState.date === date) return;
  relayBudgetState.date = date;
  relayBudgetState.analyses = 0;
  relayBudgetState.analysesPerTopic = {};
}

export function extractTopicId(articleText: string): string | undefined {
  const match = articleText.match(TOPIC_ID_LINE_PATTERN)?.[1]?.trim();
  return match && match.length > 0 ? match : undefined;
}

function resolveTokenParam(model: string): 'max_completion_tokens' | 'max_tokens' {
  if (/^(gpt-5|o1|o3)/i.test(model)) {
    return 'max_completion_tokens';
  }
  return 'max_tokens';
}

function shouldSendTemperature(model: string): boolean {
  return !/^(gpt-5|o1|o3)/i.test(model);
}

/**
 * Split a prompt into system + user messages when an article delimiter is present.
 * System instructions go in the system role; the article content goes in the user role.
 * Falls back to a single user message when no delimiter is found.
 */
function splitPromptMessages(prompt: string): Array<{ role: string; content: string }> {
  const idx = prompt.indexOf(ARTICLE_DELIMITER);
  if (idx <= 0) {
    return [{ role: 'user', content: prompt }];
  }
  const system = prompt.slice(0, idx).trim();
  const user = prompt.slice(idx).trim();
  if (!system) {
    return [{ role: 'user', content: prompt }];
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Convert a flat { prompt, model, max_tokens, temperature } request into
 * OpenAI chat-completions format ({ model, messages, max_tokens, temperature }).
 */
function toChatCompletionsPayload(request: {
  prompt: string;
  model: string;
  max_tokens: number;
  temperature: number;
}): {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
} {
  const tokenParam = resolveTokenParam(request.model);
  return {
    model: request.model,
    messages: splitPromptMessages(request.prompt),
    [tokenParam]: request.max_tokens,
    ...(shouldSendTemperature(request.model) ? { temperature: request.temperature } : {}),
  };
}

function readContentFromUpstream(body: unknown): string | null {
  if (!isObject(body)) return null;
  const fromContent = asNonEmptyString(body.content);
  if (fromContent) return fromContent;

  if (isObject(body.response)) {
    const fromResponse = asNonEmptyString(body.response.text);
    if (fromResponse) return fromResponse;
  }

  if (Array.isArray(body.choices) && isObject(body.choices[0]) && isObject(body.choices[0].message)) {
    const fromChoices = asNonEmptyString(body.choices[0].message.content);
    if (fromChoices) return fromChoices;
  }

  return null;
}

function readModelFromUpstream(body: Record<string, unknown>, fallback: string): string {
  const fromTopLevel = asNonEmptyString(body.model);
  if (fromTopLevel) return fromTopLevel;
  if (isObject(body.response)) {
    const fromResponse = asNonEmptyString(body.response.model);
    if (fromResponse) return fromResponse;
  }
  return fallback;
}

function budgetSnapshot(topicId: string | undefined): { analyses: number; analyses_per_topic: number } {
  return {
    analyses: relayBudgetState.analyses,
    analyses_per_topic: topicId ? relayBudgetState.analysesPerTopic[topicId] ?? 0 : 0,
  };
}

function canConsumeBudget(config: AnalysisRelayConfig, topicId: string | undefined): { allowed: boolean; reason?: string } {
  if (relayBudgetState.analyses >= config.analysesLimit) {
    return { allowed: false, reason: `Daily limit of ${config.analysesLimit} reached for analyses` };
  }
  if (!topicId) return { allowed: true };

  const currentTopicCount = relayBudgetState.analysesPerTopic[topicId] ?? 0;
  if (currentTopicCount >= config.analysesPerTopicLimit) {
    return {
      allowed: false,
      reason: `Per-topic cap of ${config.analysesPerTopicLimit} reached for analyses_per_topic on topic ${topicId}`,
    };
  }
  return { allowed: true };
}

function consumeBudget(topicId: string | undefined): void {
  relayBudgetState.analyses += 1;
  if (!topicId) return;
  relayBudgetState.analysesPerTopic[topicId] = (relayBudgetState.analysesPerTopic[topicId] ?? 0) + 1;
}

export async function relayAnalysis(
  rawBody: unknown,
  options: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined>; now?: () => Date } = {},
): Promise<AnalysisRelayResult> {
  const env =
    options.env ??
    ((typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>);
  const config = resolveAnalysisRelayConfig(env);
  if (!config) {
    return { status: 503, payload: { error: 'Analysis relay is not configured' } };
  }

  const articleRequest = parseArticleRequest(rawBody);
  const promptRequest = articleRequest ? null : parsePromptRequest(rawBody);
  if (!articleRequest && !promptRequest) {
    return { status: 400, payload: { error: 'Invalid relay request payload' } };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  resetBudgetIfNeeded(now());

  const topicId = articleRequest
    ? articleRequest.topicId ?? extractTopicId(articleRequest.articleText)
    : promptRequest!.topicId;

  const budgetCheck = canConsumeBudget(config, topicId);
  if (!budgetCheck.allowed) {
    return { status: 429, payload: { error: budgetCheck.reason, budget: budgetSnapshot(topicId) } };
  }

  const baseRequest = articleRequest
    ? buildRemoteRequest(buildLegacyVhcArticlePrompt(articleRequest.articleText))
    : buildRemoteRequest(promptRequest!.prompt);

  const upstreamRequest = {
    ...baseRequest,
    ...(promptRequest
      ? {
          model: promptRequest.model ?? baseRequest.model,
          max_tokens: promptRequest.max_tokens ?? baseRequest.max_tokens,
          temperature: promptRequest.temperature ?? baseRequest.temperature,
        }
      : {}),
    ...(config.modelOverride ? { model: config.modelOverride } : {}),
    ...(articleRequest?.model ? { model: articleRequest.model } : {}),
  };

  try {
    const chatPayload = toChatCompletionsPayload(upstreamRequest);
    const maxAttempts = 1 + UPSTREAM_EMPTY_CONTENT_RETRIES;
    let lastUpstreamBody: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const upstream = await fetchImpl(config.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(chatPayload),
      });

      if (!upstream.ok) {
        return { status: 502, payload: { error: `Upstream returned ${upstream.status}` } };
      }

      lastUpstreamBody = await upstream.json();
      const content = readContentFromUpstream(lastUpstreamBody);
      if (content) {
        const provider: AnalysisProvider = {
          provider_id: config.providerId,
          model_id: readModelFromUpstream(lastUpstreamBody as Record<string, unknown>, upstreamRequest.model),
          kind: 'remote',
        };

        let analysis: AnalysisResult | undefined;
        if (articleRequest) {
          try {
            analysis = { ...parseAnalysisResponse(content), provider };
          } catch (error) {
            return {
              status: 502,
              payload: {
                error: 'Relay could not parse analysis output',
                details: error instanceof Error ? error.message : 'Unknown parse failure',
              },
            };
          }
        }

        consumeBudget(topicId);
        return {
          status: 200,
          payload: { content, analysis, provider, budget: budgetSnapshot(topicId) },
        };
      }

      // Content was empty/null — retry if attempts remain
    }

    return { status: 502, payload: { error: 'Upstream response missing content' } };
  } catch (error) {
    return {
      status: 502,
      payload: { error: error instanceof Error ? error.message : 'Relay request failed' },
    };
  }
}

export function __resetAnalysisRelayBudgetForTests(): void {
  relayBudgetState.date = '';
  relayBudgetState.analyses = 0;
  relayBudgetState.analysesPerTopic = {};
}
