import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let workspacePackageCache = null;

function isRelativeSpecifier(specifier) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/')
  );
}

function workspacePackages() {
  if (workspacePackageCache) {
    return workspacePackageCache;
  }

  const packages = new Map();
  for (const rootName of ['packages', 'services', 'apps']) {
    const rootDir = path.join(repoRoot, rootName);
    if (!fs.existsSync(rootDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageDir = path.join(rootDir, entry.name);
      const packageJsonPath = path.join(packageDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (typeof manifest.name === 'string' && manifest.name.startsWith('@vh/')) {
          packages.set(manifest.name, { packageDir, manifest });
        }
      } catch {
        // Fall through to default Node resolution for malformed manifests.
      }
    }
  }

  workspacePackageCache = packages;
  return packages;
}

function importTargetForExport(exportEntry) {
  if (typeof exportEntry === 'string') {
    return exportEntry;
  }
  if (!exportEntry || typeof exportEntry !== 'object') {
    return undefined;
  }
  return exportEntry.import ?? exportEntry.default ?? exportEntry.require;
}

function workspacePackageTarget(specifier) {
  if (!specifier.startsWith('@vh/')) {
    return null;
  }

  const [scope, name, ...subpathParts] = specifier.split('/');
  const packageName = `${scope}/${name}`;
  const workspacePackage = workspacePackages().get(packageName);
  if (!workspacePackage) {
    return null;
  }

  const subpath = subpathParts.length > 0 ? `./${subpathParts.join('/')}` : '.';
  const exportsMap = workspacePackage.manifest.exports;
  let exportEntry;
  if (subpath === '.') {
    exportEntry = exportsMap?.['.'] ?? workspacePackage.manifest.main;
  } else {
    exportEntry = exportsMap?.[subpath];
  }

  const target = importTargetForExport(exportEntry);
  if (!target) {
    return null;
  }

  const candidate = path.resolve(workspacePackage.packageDir, target);
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

export async function resolve(specifier, context, defaultResolve) {
  const workspaceTarget = workspacePackageTarget(specifier);
  if (workspaceTarget) {
    return {
      url: pathToFileURL(workspaceTarget).href,
      shortCircuit: true,
    };
  }

  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ERR_UNSUPPORTED_DIR_IMPORT') {
      throw error;
    }

    // Gun's ESM path requires explicit .js in Node ESM runtime.
    if (specifier === 'gun/sea') {
      return defaultResolve('gun/sea.js', context, defaultResolve);
    }

    if (!isRelativeSpecifier(specifier) || !context.parentURL?.startsWith('file:')) {
      throw error;
    }

    const hasExtension = path.extname(specifier).length > 0;
    if (hasExtension) {
      throw error;
    }

    const parentPath = fileURLToPath(context.parentURL);
    const parentDir = path.dirname(parentPath);
    const candidates = [
      path.resolve(parentDir, `${specifier}.js`),
      path.resolve(parentDir, `${specifier}.ts`),
      path.resolve(parentDir, `${specifier}.tsx`),
      path.resolve(parentDir, `${specifier}.mjs`),
      path.resolve(parentDir, `${specifier}.mts`),
      path.resolve(parentDir, specifier, 'index.js'),
      path.resolve(parentDir, specifier, 'index.ts'),
      path.resolve(parentDir, specifier, 'index.mjs'),
      path.resolve(parentDir, specifier, 'index.mts'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return {
          url: pathToFileURL(candidate).href,
          shortCircuit: true,
        };
      }
    }

    throw error;
  }
}
