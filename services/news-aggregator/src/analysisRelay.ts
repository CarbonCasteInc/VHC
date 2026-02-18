import type { Request, Response } from 'express';
import { AnalysisResultSchema } from '@vh/ai-engine';
import { GOALS_AND_GUIDELINES, PRIMARY_OUTPUT_FORMAT_REQ } from '@vh/ai-engine';

export const MAX_TOKENS = 3000;
export const TEMPERATURE = 0.3;
export const RATE_LIMIT_PER_MIN = 10;
export const RATE_WINDOW_MS = 60_000;

export function getRelayModel(): string {
  return process.env.ANALYSIS_RELAY_MODEL || process.env.VITE_ANALYSIS_MODEL || 'gpt-4o-mini';
}

export function resolveTokenParam(model: string): 'max_completion_tokens' | 'max_tokens' {
  if (/^(gpt-5|o1|o3)/i.test(model)) return 'max_completion_tokens';
  return 'max_tokens';
}

// Rate limiting
const rateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_PER_MIN) return false;
  entry.count++;
  return true;
}

export function resetRateLimits(): void {
  rateLimits.clear();
}

export interface AnalyzeRequest {
  articleText: string;
  model?: string;
  storyId?: string;
  topicId?: string;
}

export interface AnalyzeResponse {
  analysis: ReturnType<typeof AnalysisResultSchema.parse>;
  provenance: {
    provider_id: string;
    model: string;
    timestamp: number;
  };
}

function buildSystemPrompt(): string {
  return [
    'You are an AI assistant that analyzes news articles.',
    GOALS_AND_GUIDELINES.trim(),
    'YOU MUST RETURN YOUR ANSWER AS A SINGLE JSON OBJECT WITH THIS STRUCTURE:',
    PRIMARY_OUTPUT_FORMAT_REQ.trim(),
    'Ensure the response strictly follows JSON format, with all fields included even if they are empty.',
  ].join('\n\n');
}

export function buildOpenAIChatRequest(articleText: string, model?: string) {
  const usedModel = model || getRelayModel();
  const tokenParam = resolveTokenParam(usedModel);

  return {
    model: usedModel,
    messages: [
      { role: 'system' as const, content: buildSystemPrompt() },
      { role: 'user' as const, content: `Analyze this news article:\n\n${articleText}` },
    ],
    [tokenParam]: MAX_TOKENS,
    temperature: TEMPERATURE,
    response_format: { type: 'json_object' as const },
  };
}

export async function handleAnalyze(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Analysis service not configured (missing API key)' });
    return;
  }

  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }

  const { articleText, model, storyId, topicId } = req.body as AnalyzeRequest;
  void storyId;
  void topicId;

  if (!articleText || typeof articleText !== 'string' || articleText.trim().length === 0) {
    res.status(400).json({ error: 'articleText is required' });
    return;
  }

  const usedModel = model || getRelayModel();
  const requestBody = buildOpenAIChatRequest(articleText.trim(), usedModel);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      res.status(502).json({ error: `OpenAI API error: ${response.status}`, detail: errorText });
      return;
    }

    const body = (await response.json()) as any;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      res.status(502).json({ error: 'No content in OpenAI response' });
      return;
    }

    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(502).json({ error: 'No JSON found in OpenAI response' });
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const payload = parsed.final_refined || parsed;
    const analysis = AnalysisResultSchema.parse(payload);

    const result: AnalyzeResponse = {
      analysis: { ...analysis, provider_id: 'openai', model_id: usedModel },
      provenance: {
        provider_id: 'openai',
        model: usedModel,
        timestamp: Date.now(),
      },
    };

    res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    res.status(500).json({ error: message });
  }
}
