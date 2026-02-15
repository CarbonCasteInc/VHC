import { z } from 'zod';

export const DEFAULT_ANALYSIS_MODEL = 'gpt-5.2';

const NonEmptyStringSchema = z.string().trim().min(1);

export const RemoteAnalysisRequestSchema = z
  .object({
    prompt: z.string().min(1),
    model: z.string().min(1),
    max_tokens: z.number().int().positive().default(2048),
    temperature: z.number().min(0).max(2).default(0.1),
  })
  .strict();

export interface RemoteAnalysisRequest {
  prompt: string;
  model: string;
  max_tokens: number;
  temperature: number;
}

function readEnvVar(name: string): string | undefined {
  const viteValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[
    name
  ];

  const processValue = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env?.[name];

  const candidate = viteValue ?? processValue;
  const parsed = NonEmptyStringSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function getAnalysisModel(): string {
  return readEnvVar('VITE_ANALYSIS_MODEL') ?? DEFAULT_ANALYSIS_MODEL;
}

export class RemoteAuthError extends Error {
  constructor(message = 'Remote inference requires VITE_REMOTE_API_KEY') {
    super(message);
    this.name = 'RemoteAuthError';
  }
}

export function getRemoteApiKey(): string {
  const apiKey = readEnvVar('VITE_REMOTE_API_KEY');
  if (!apiKey) {
    throw new RemoteAuthError();
  }
  return apiKey;
}

export function validateRemoteAuth(): void {
  getRemoteApiKey();
}

export function buildRemoteRequest(prompt: string): RemoteAnalysisRequest {
  return RemoteAnalysisRequestSchema.parse({
    prompt,
    model: getAnalysisModel(),
  });
}

export const __internal = {
  readEnvVar,
};
