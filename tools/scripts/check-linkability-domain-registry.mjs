#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registryPath = path.join(rootDir, 'packages/luma-sdk/src/linkabilityDomains.ts');
const specPath = path.join(rootDir, 'docs/specs/spec-luma-service-v0.md');

const expectedDomains = [
  {
    name: 'forum-author-v1',
    scope: 'global',
    saltSource: 'none',
    info: 'vh:forum-author:v1',
    linkabilityProfile: 'global',
    publicVisibility: 'public-mesh',
    rotationPolicy: 'on-reset-identity',
    ownerSpec: 'spec-hermes-forum-v0.md'
  },
  {
    name: 'identity-directory-v1',
    scope: 'global',
    saltSource: 'none',
    info: 'vh:identity-directory:v1',
    linkabilityProfile: 'global',
    publicVisibility: 'public-mesh',
    rotationPolicy: 'on-reset-identity',
    ownerSpec: 'spec-luma-service-v0.md'
  },
  {
    name: 'voter-v1',
    scope: 'topic-epoch-scoped',
    saltSource: 'topic-id+epoch',
    info: 'vh:voter:v1',
    linkabilityProfile: 'unlinkable-across-scope',
    publicVisibility: 'public-mesh',
    rotationPolicy: 'on-reset-identity',
    ownerSpec: 'spec-civic-sentiment.md'
  }
];

const registrySource = fs.readFileSync(registryPath, 'utf8');
const specSource = fs.readFileSync(specPath, 'utf8');
const sourceFile = ts.createSourceFile(registryPath, registrySource, ts.ScriptTarget.Latest, true);

const registry = extractInitialRegistry(sourceFile);
const failures = [];

if (registry.length !== expectedDomains.length) {
  failures.push(`expected ${expectedDomains.length} registry domains, found ${registry.length}`);
}

const seen = new Set();
for (const domain of registry) {
  if (seen.has(domain.name)) {
    failures.push(`duplicate registry domain: ${domain.name}`);
  }
  seen.add(domain.name);
}

for (const expected of expectedDomains) {
  const actual = registry.find((domain) => domain.name === expected.name);
  if (!actual) {
    failures.push(`missing registry domain: ${expected.name}`);
    continue;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      failures.push(`${expected.name}.${key} expected ${expectedValue}, found ${actual[key]}`);
    }
  }

  const specRow = [
    `| \`${expected.name}\``,
    `| ${expected.scope}`,
    `| ${expected.saltSource}`,
    `| \`${expected.info}\``,
    `| ${expected.linkabilityProfile}`,
    `| ${expected.publicVisibility}`,
    `| ${expected.rotationPolicy}`,
    `| \`${expected.ownerSpec}\` |`
  ].join(' ');

  if (!specSource.includes(specRow)) {
    failures.push(`spec §9.3 row missing or drifted for ${expected.name}`);
  }
}

for (const expected of expectedDomains) {
  if (!seen.has(expected.name)) {
    failures.push(`expected registry domain not present: ${expected.name}`);
  }
}

for (const name of seen) {
  if (!expectedDomains.some((domain) => domain.name === name)) {
    failures.push(`unexpected registry domain: ${name}`);
  }
}

if (failures.length > 0) {
  console.error('[check:linkability-domain-registry] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:linkability-domain-registry] registry integrity ok');

function extractInitialRegistry(source) {
  let initializer;

  visit(source);

  if (!initializer) {
    throw new Error('INITIAL_LINKABILITY_DOMAINS was not found');
  }

  const arrayLiteral = unwrapArrayLiteral(initializer);
  return arrayLiteral.elements.map((element) => extractDomainObject(element));

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'INITIAL_LINKABILITY_DOMAINS') {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
}

function unwrapArrayLiteral(expression) {
  const unwrapped = unwrapExpression(expression);

  if (ts.isCallExpression(unwrapped) && unwrapped.expression.getText(sourceFile) === 'Object.freeze') {
    return unwrapArrayLiteral(unwrapped.arguments[0]);
  }

  if (!ts.isArrayLiteralExpression(unwrapped)) {
    throw new Error('INITIAL_LINKABILITY_DOMAINS is not an array literal');
  }

  return unwrapped;
}

function extractDomainObject(expression) {
  const unwrapped = unwrapExpression(expression);
  const objectLiteral =
    ts.isCallExpression(unwrapped) && unwrapped.expression.getText(sourceFile) === 'Object.freeze'
      ? unwrapExpression(unwrapped.arguments[0])
      : unwrapped;

  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    throw new Error('registry entry is not an object literal');
  }

  const entry = {};
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const key = property.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
    const value = unwrapExpression(property.initializer);
    if (!ts.isStringLiteralLike(value)) {
      throw new Error(`registry entry property ${key} is not a string literal`);
    }
    entry[key] = value.text;
  }

  return entry;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
