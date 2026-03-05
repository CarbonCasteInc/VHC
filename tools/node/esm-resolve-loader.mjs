import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function isRelativeSpecifier(specifier) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/')
  );
}

export async function resolve(specifier, context, defaultResolve) {
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
