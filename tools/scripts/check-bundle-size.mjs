#!/usr/bin/env node
import { createGzip } from 'node:zlib';
import { promisify } from 'node:util';
import { pipeline as pipelineCb } from 'node:stream';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const pipeline = promisify(pipelineCb);

async function gzipSize(filePath) {
  const gzip = createGzip();
  let size = 0;
  await pipeline(createReadStream(filePath), gzip, async function* (source) {
    for await (const chunk of source) {
      size += chunk.length;
    }
  });
  return size;
}

function isLazyAiAsset(content) {
  return content.includes('web-llm') || content.includes('MLCEngine');
}

async function main() {
  const [targetDir = 'apps/web-pwa/dist/assets', rawInitialBudget = '1048576', rawLazyBudget = '10485760'] =
    process.argv.slice(2);
  const initialBudget = Number(rawInitialBudget);
  const lazyBudget = Number(rawLazyBudget);
  if (Number.isNaN(initialBudget) || Number.isNaN(lazyBudget)) {
    console.error('Invalid budget provided.');
    process.exit(1);
  }

  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const jsAssets = entries
    .filter((e) => e.isFile() && e.name.startsWith('index-') && e.name.endsWith('.js'))
    .map((e) => path.join(targetDir, e.name));

  if (jsAssets.length === 0) {
    console.error(`No index-*.js assets found in ${targetDir}`);
    process.exit(1);
  }

  let violations = 0;
  for (const asset of jsAssets) {
    const gzSize = await gzipSize(asset);
    const kb = (gzSize / 1024).toFixed(2);
    const content = await fs.readFile(asset, 'utf8');
    const lazy = isLazyAiAsset(content);
    const budget = lazy ? lazyBudget : initialBudget;
    console.log(
      `Asset: ${path.basename(asset)} gzipped size: ${kb} KiB ${lazy ? '(lazy AI asset)' : '(initial)'}`
    );
    if (gzSize > budget) {
      violations += 1;
      console.error(`  Exceeds ${lazy ? 'lazy' : 'initial'} budget ${budget} bytes`);
    }
  }

  if (violations > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
