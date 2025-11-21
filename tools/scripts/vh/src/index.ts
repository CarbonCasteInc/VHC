#!/usr/bin/env tsx
import { Command } from 'commander';
import chalk from 'chalk';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execa } from 'execa';
import { COMPOSE_FILE, ENV_FILE, INFRA_DOCKER_DIR, REPO_ROOT, loadEnv, pathExists } from './env.js';
import { bootstrapCheck } from './commands/check.js';

const format = {
  info: (msg: string) => console.log(chalk.cyan(msg)),
  success: (msg: string) => console.log(chalk.green(msg)),
  warn: (msg: string) => console.warn(chalk.yellow(msg)),
  error: (msg: string) => console.error(chalk.red(msg))
};

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function buildSecrets() {
  return {
    MINIO_ROOT_USER: randomBase64Url(18).slice(0, 20),
    MINIO_ROOT_PASSWORD: randomBase64Url(36),
    TURN_SECRET: randomBase64Url(24),
    JWT_SECRET: randomBase64Url(48),
    AGREGATOR_KEY: randomHex(32),
    TLS_CA_KEY: randomHex(32)
  };
}

async function writeEnvFile(force = false) {
  await fs.mkdir(INFRA_DOCKER_DIR, { recursive: true });
  const exists = await pathExists(ENV_FILE);

  if (exists) {
    if (!force) {
      throw new Error(
        `Environment file already exists at ${ENV_FILE}. Use --force to regenerate (backups will be created).`
      );
    }

    const backupName = `.env.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const backupPath = path.join(INFRA_DOCKER_DIR, backupName);
    await fs.copyFile(ENV_FILE, backupPath);
    format.warn(`Existing .env backed up to ${backupPath}`);
  }

  const secrets = buildSecrets();
  const body = Object.entries(secrets)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
    .concat('\n');

  await fs.writeFile(ENV_FILE, body, { mode: 0o600 });
  format.success(`Secrets written to ${ENV_FILE}`);
}

async function ensureDockerAvailable() {
  try {
    await execa('docker', ['--version']);
    await execa('docker', ['compose', 'version']);
  } catch (error) {
    throw new Error('Docker with Compose plugin is required. Please install Docker Desktop or docker-cli + compose.');
  }
}


async function runComposeUp(envMap: Record<string, string>) {
  const composeExists = await pathExists(COMPOSE_FILE);
  if (!composeExists) {
    throw new Error(`Cannot find docker-compose file at ${COMPOSE_FILE}`);
  }

  await execa(
    'docker',
    ['compose', '--env-file', ENV_FILE, '-f', COMPOSE_FILE, 'up', '-d'],
    {
      cwd: INFRA_DOCKER_DIR,
      stdio: 'inherit'
    }
  );

  const summary = [
    { name: 'Traefik HTTP', url: 'http://localhost:8080' },
    { name: 'Traefik HTTPS', url: 'https://localhost:8443' },
    { name: 'Traefik Dashboard', url: 'http://localhost:8081' },
    { name: 'MinIO API', url: 'http://localhost:9000' },
    { name: 'MinIO Console', url: 'http://localhost:9001' },
    { name: 'Relay (placeholder)', url: 'ws://localhost:7777' },
    { name: 'TURN (UDP/TCP)', url: 'turn:localhost:3478', note: `secret ${envMap.TURN_SECRET?.slice(0, 8)}…` },
    { name: 'Anvil RPC', url: 'http://localhost:8545' }
  ];

  format.success('Home server stack is starting...');
  console.log();
  console.log(chalk.bold('Service Summary'));
  for (const service of summary) {
    const note = service.note ? chalk.gray(` (${service.note})`) : '';
    console.log(`  • ${chalk.white(service.name)} → ${chalk.green(service.url)}${note}`);
  }
  console.log();
}

function registerBootstrapCommands(program: Command) {
  const bootstrap = new Command('bootstrap').description('Bootstrap/TRINITY home server tasks');

  bootstrap
    .command('init')
    .description('Generate local secrets for the home server stack')
    .option('-f, --force', 'Regenerate secrets even if .env exists (creates a backup first)')
    .action(async (options: { force?: boolean }) => {
      try {
        await writeEnvFile(Boolean(options.force));
      } catch (error) {
        format.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  bootstrap
    .command('up')
    .description('Start the local Docker-based home server stack')
    .action(async () => {
      try {
        await ensureDockerAvailable();
        const env = await loadEnv();
        await runComposeUp(env);
      } catch (error) {
        format.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  bootstrap
    .command('check')
    .description('Validate the running home server stack')
    .action(async () => {
      try {
        await bootstrapCheck();
      } catch (error) {
        format.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  program.addCommand(bootstrap);

  program
    .command('dev')
    .description('Run the web PWA in dev mode (assumes stack is up)')
    .action(async () => {
      try {
        await execa('pnpm', ['--filter', 'apps/web-pwa', 'dev'], {
          cwd: REPO_ROOT,
          stdio: 'inherit'
        });
      } catch (error) {
        format.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}

async function main() {
  const program = new Command();
  program
    .name('vh')
    .description('VENN/HERMES developer experience toolkit')
    .version('0.0.1');

  registerBootstrapCommands(program);

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    format.error((error as Error).message);
    process.exit(1);
  }
}

void main();
