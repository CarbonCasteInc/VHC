import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import dotenv from 'dotenv';

export const REQUIRED_ENV_KEYS = [
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'TURN_SECRET',
  'JWT_SECRET',
  'AGREGATOR_KEY',
  'TLS_CA_KEY'
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '../../../../');
export const INFRA_DOCKER_DIR = path.join(REPO_ROOT, 'infra', 'docker');
export const ENV_FILE = path.join(INFRA_DOCKER_DIR, '.env');
export const COMPOSE_FILE = path.join(INFRA_DOCKER_DIR, 'docker-compose.yml');

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function loadEnv(): Promise<Record<string, string>> {
  if (!(await pathExists(ENV_FILE))) {
    throw new Error(`Missing ${ENV_FILE}. Run 'pnpm vh bootstrap init' first.`);
  }

  const raw = await fs.readFile(ENV_FILE, 'utf8');
  const parsed = dotenv.parse(raw);
  const missing = REQUIRED_ENV_KEYS.filter((key) => !parsed[key] || parsed[key].trim() === '');

  if (missing.length > 0) {
    throw new Error(`Missing required secrets in ${ENV_FILE}: ${missing.join(', ')}`);
  }

  return parsed;
}
