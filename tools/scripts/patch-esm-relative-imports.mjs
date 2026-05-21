#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.argv[2] || '');
if (!rootDir || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
  console.error('usage: patch-esm-relative-imports.mjs <dist-dir>');
  process.exit(1);
}

const EXTENSION_PATTERN = /\.[a-z0-9]+$/i;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && fullPath.endsWith('.js') ? [fullPath] : [];
  });
}

function patchSpecifier(filePath, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
  if (EXTENSION_PATTERN.test(path.basename(specifier))) return specifier;

  const resolved = path.resolve(path.dirname(filePath), specifier);
  if (fs.existsSync(`${resolved}.js`)) return `${specifier}.js`;
  if (fs.existsSync(path.join(resolved, 'index.js'))) return `${specifier.replace(/\/$/, '')}/index.js`;
  return specifier;
}

function patchSource(filePath, source) {
  return source
    .replace(/(\bfrom\s*['"])(\.[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) =>
      `${prefix}${patchSpecifier(filePath, specifier)}${suffix}`)
    .replace(/(\bimport\s*['"])(\.[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) =>
      `${prefix}${patchSpecifier(filePath, specifier)}${suffix}`)
    .replace(/(\bimport\s*\(\s*['"])(\.[^'"]+)(['"]\s*\))/g, (_match, prefix, specifier, suffix) =>
      `${prefix}${patchSpecifier(filePath, specifier)}${suffix}`);
}

let patchedFiles = 0;
for (const filePath of walk(rootDir)) {
  const before = fs.readFileSync(filePath, 'utf8');
  const after = patchSource(filePath, before);
  if (after !== before) {
    fs.writeFileSync(filePath, after);
    patchedFiles += 1;
  }
}

console.log(`[patch-esm-relative-imports] patched ${patchedFiles} file(s) in ${rootDir}`);
