import chalk from 'chalk';
import { loadEnv } from '../env.js';

type HealthTarget = {
  name: string;
  url: string;
};

const format = {
  info: (msg: string) => console.log(chalk.cyan(msg)),
  success: (msg: string) => console.log(chalk.green(msg)),
  error: (msg: string) => console.error(chalk.red(msg))
};

const HEALTH_TARGETS: HealthTarget[] = [
  { name: 'Traefik dashboard API', url: 'http://localhost:8081/api/rawdata' },
  { name: 'MinIO live probe', url: 'http://localhost:9000/minio/health/live' }
];

const REQUEST_TIMEOUT_MS = 5000;

function maskSecret(secret: string | undefined, visible = 4) {
  if (!secret) return 'not-set';
  if (secret.length <= visible * 2) {
    return secret;
  }
  return `${secret.slice(0, visible)}…${secret.slice(-visible)}`;
}

async function probeTarget(target: HealthTarget) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(target.url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.status;
  } catch (error) {
    clearTimeout(timer);
    throw new Error((error as Error).message);
  }
}

export async function bootstrapCheck() {
  const env = await loadEnv();
  format.info('Loaded secrets for health verification');
  format.info(`  • MINIO_ROOT_USER: ${env.MINIO_ROOT_USER}`);
  format.info(`  • TURN_SECRET: ${maskSecret(env.TURN_SECRET)}`);

  let failures = 0;
  for (const target of HEALTH_TARGETS) {
    try {
      const status = await probeTarget(target);
      format.success(`✓ ${target.name} responded (HTTP ${status})`);
    } catch (error) {
      failures += 1;
      format.error(`✗ ${target.name} failed → ${(error as Error).message}`);
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} bootstrap health check(s) failed.`);
  }

  format.success('All bootstrap health checks passed.');
}
