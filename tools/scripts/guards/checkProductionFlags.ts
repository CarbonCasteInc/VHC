import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const loadEnv = (file: string) => {
  if (!existsSync(file)) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    let [, key, value] = match;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }

  return out;
};

const resolveEnv = () => ({
  ...loadEnv(resolve('.env')),
  ...loadEnv(resolve('.env.production')),
  ...process.env,
});

const collectMessages = (
  env: Record<string, string | undefined>,
  production: boolean,
) => {
  const messages: string[] = [];
  const proofReal = env.VITE_CONSTITUENCY_PROOF_REAL;
  const e2eMode = env.VITE_E2E_MODE;

  if (production) {
    if (proofReal !== 'true') {
      messages.push(
        'VITE_CONSTITUENCY_PROOF_REAL must be "true" for production builds. Set it in .env.production or CI.',
      );
    }
    if (e2eMode === 'true') {
      messages.push('VITE_E2E_MODE must be "false" for production builds. Disable E2E mode.');
    }
  } else {
    if (proofReal !== 'true') {
      messages.push('VITE_CONSTITUENCY_PROOF_REAL is not "true" (non-production only).');
    }
    if (e2eMode === 'true') {
      messages.push('VITE_E2E_MODE is "true" (non-production only).');
    }
  }

  return { messages, ok: production ? messages.length === 0 : true };
};

export const run = (argv = process.argv, env = resolveEnv()) => {
  const production = argv.includes('--production') || env.NODE_ENV === 'production';
  const { messages, ok } = collectMessages(env, production);

  if (messages.length) {
    const log = production ? console.error : console.warn;
    const tag = production ? 'ERROR' : 'WARN';
    for (const msg of messages) {
      log(`[guard] ${tag}: ${msg}`);
    }
  }

  return ok;
};

const entry = process.argv[1];
/* c8 ignore next 3 */
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exit(run() ? 0 : 1);
}
