#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const artifactRoot = path.join(repoRoot, '.tmp/mesh-luma-gated-write-coverage');
const latestDir = path.join(artifactRoot, 'latest');

export const LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION = 'mesh-luma-gated-write-coverage-v1';
export const LUMA_GATED_WRITE_COVERAGE_MODE = 'luma_gated_write_coverage';
export const LUMA_GATED_WRITE_COVERAGE_COMMAND = 'pnpm test:mesh:luma-gated-write-coverage';
export const LUMA_GATED_WRITE_COVERAGE_REPORT_NAME = 'mesh-luma-gated-write-coverage-report.json';
export const LUMA_GATED_WRITE_COVERAGE_REPORT_ENV = 'VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT';
export const DEFAULT_LUMA_SCHEMA_EPOCH = 'post_luma_m0b';
export const LOCAL_E2E_LUMA_PROFILE = 'e2e';
export const LOCAL_E2E_MODE = 'local-e2e';
export const REQUIRED_LUMA_WRITE_CLASSES = [
  {
    id: 'forum_thread',
    label: 'forum thread',
    aliases: ['forum thread', 'forum-thread', 'forum_thread', 'forum'],
  },
  {
    id: 'forum_comment',
    label: 'forum comment',
    aliases: ['forum comment', 'forum-comment', 'forum_comment', 'comment'],
  },
  {
    id: 'vote_or_aggregate',
    label: 'vote or aggregate',
    aliases: [
      'vote',
      'votes',
      'vote or aggregate',
      'vote/aggregate',
      'vote_or_aggregate',
      'aggregate',
      'aggregate voter node',
      'point aggregate voter node',
      'aggregate snapshot',
      'point aggregate snapshot',
    ],
  },
  {
    id: 'directory_publish',
    label: 'directory publish',
    aliases: ['directory publish', 'directory-publish', 'directory_publish', 'directory entry', 'directory'],
  },
  {
    id: 'news_report_status',
    label: 'news report/status',
    aliases: [
      'news report',
      'news-report',
      'news_report',
      'news status',
      'news-status',
      'news_report_status',
      'news report/status',
      'report status',
    ],
  },
];

const acceptedReaderPathValues = new Set([
  'luma',
  'luma reader',
  'luma reader path',
  'luma readback',
  'luma reader path evidence',
  'luma reader validated',
]);

const classAliasByKey = new Map(
  REQUIRED_LUMA_WRITE_CLASSES.flatMap((definition) =>
    [definition.id, definition.label, ...definition.aliases].map((alias) => [normalizeKey(alias), definition.id]),
  ),
);

function nowIsoCompact(date = new Date()) {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

function makeId(prefix) {
  return `${prefix}-${nowIsoCompact()}-${crypto.randomBytes(4).toString('hex')}`;
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sourcePath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function commandText(args = process.argv.slice(2)) {
  return [LUMA_GATED_WRITE_COVERAGE_COMMAND, ...args].join(' ').trim();
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function bytesToBufferSource(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readOnce(chain) {
  return new Promise((resolve) => {
    chain.once((data) => resolve(data ?? null));
  });
}

function rowsFromReport(report) {
  const rowCollections = [
    report?.luma_gated_write_drills,
    report?.coverage_rows,
    report?.coverage?.classes,
    report?.luma_gated_write_coverage?.required_write_classes,
  ];
  return rowCollections.flatMap((rows) => (Array.isArray(rows) ? rows : []));
}

function classIdForRow(row) {
  const value = row?.coverage_class || row?.write_class_id || row?.write_class || row?.class || row?.label;
  return classAliasByKey.get(normalizeKey(value)) || null;
}

function writerKindForRow(row) {
  return row?.writer_kind || row?.writerKind || row?._writerKind || row?.public_protocol_fields?._writerKind || null;
}

function readerPathForRow(row) {
  return (
    row?.reader_path ||
    row?.readerPath ||
    row?.readback_path ||
    row?.verification_path ||
    row?.evidence_path ||
    row?.path ||
    null
  );
}

function hasAcceptedReaderPath(row) {
  if (row?.luma_reader_path === true || row?.reader_path_verified === true) return true;
  return acceptedReaderPathValues.has(normalizeKey(readerPathForRow(row)));
}

function hasSyntheticMarker(row) {
  const namespace = row?.namespace || row?.write_namespace || row?.source_namespace || '';
  return (
    row?.synthetic === true ||
    row?.synthetic_mesh_drill === true ||
    row?.drill_writer_kind === 'mesh-drill' ||
    row?._drillWriterKind === 'mesh-drill' ||
    String(namespace).startsWith('vh/__mesh_drills/')
  );
}

function rowEvidenceFailures(row, { expectedSchemaEpoch, expectedLumaProfile, currentCommit }) {
  const failures = [];
  if (row?.status !== 'pass') {
    failures.push(`status is ${row?.status || 'missing'}`);
  }
  if (writerKindForRow(row) !== 'luma') {
    failures.push(`writer kind is ${writerKindForRow(row) || 'missing'}`);
  }
  if (!hasAcceptedReaderPath(row)) {
    failures.push(`reader path is ${readerPathForRow(row) || 'missing'}`);
  }
  if (hasSyntheticMarker(row)) {
    failures.push('row is marked as synthetic mesh-drill evidence');
  }
  if (!row?.trace_id) {
    failures.push('missing trace_id');
  }
  if (row?.schema_epoch && row.schema_epoch !== expectedSchemaEpoch) {
    failures.push(`schema_epoch is ${row.schema_epoch}`);
  }
  if (expectedLumaProfile && row?.luma_profile && row.luma_profile !== expectedLumaProfile) {
    failures.push(`luma_profile is ${row.luma_profile}`);
  }
  if (currentCommit && row?.repo_commit && row.repo_commit !== currentCommit) {
    failures.push(`repo_commit is ${row.repo_commit}`);
  }
  return failures;
}

function classResult({ definition, rows, expectedSchemaEpoch, expectedLumaProfile, currentCommit }) {
  const matchingRows = rows.filter((row) => classIdForRow(row) === definition.id);
  const evaluatedRows = matchingRows.map((row) => ({
    row,
    failures: rowEvidenceFailures(row, { expectedSchemaEpoch, expectedLumaProfile, currentCommit }),
  }));
  const accepted = evaluatedRows.find((entry) => entry.failures.length === 0);

  if (accepted) {
    return {
      write_class: definition.id,
      label: definition.label,
      status: 'pass',
      trace_id: accepted.row.trace_id,
      writer_kind: writerKindForRow(accepted.row),
      reader_path: readerPathForRow(accepted.row) || 'luma_reader_path',
      schema_epoch: accepted.row.schema_epoch || expectedSchemaEpoch,
      luma_profile: accepted.row.luma_profile || expectedLumaProfile || null,
    };
  }

  const reason = matchingRows.length === 0
    ? `missing ${definition.label} LUMA reader-path evidence`
    : `${definition.label} evidence did not satisfy strict LUMA reader-path contract: ${unique(evaluatedRows.flatMap((entry) => entry.failures)).join('; ')}`;

  return {
    write_class: definition.id,
    label: definition.label,
    status: 'blocked',
    reason,
  };
}

export function validateLumaCoverageReport(report, {
  currentCommit = null,
  requireClean = true,
  expectedSchemaEpoch = DEFAULT_LUMA_SCHEMA_EPOCH,
  expectedLumaProfile = null,
} = {}) {
  const failures = [];
  const rows = rowsFromReport(report);

  if (!report || typeof report !== 'object') {
    return {
      ok: false,
      status: 'blocked',
      failures: ['missing or malformed LUMA coverage report'],
      required_write_classes: REQUIRED_LUMA_WRITE_CLASSES.map((definition) => ({
        write_class: definition.id,
        label: definition.label,
        status: 'blocked',
        reason: 'missing or malformed LUMA coverage report',
      })),
    };
  }

  if (report.schema_version !== LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION) {
    failures.push(`unexpected schema_version ${report.schema_version || 'missing'}`);
  }
  if (report.status !== 'pass') {
    failures.push(`report status is ${report.status || 'missing'}`);
  }
  if (report.schema_epoch !== expectedSchemaEpoch) {
    failures.push(`schema_epoch is ${report.schema_epoch || 'missing'}`);
  }
  if (!report.luma_profile || report.luma_profile === 'none') {
    failures.push(`luma_profile is ${report.luma_profile || 'missing'}`);
  }
  if (expectedLumaProfile && report.luma_profile !== expectedLumaProfile) {
    failures.push(`luma_profile is ${report.luma_profile || 'missing'}, expected ${expectedLumaProfile}`);
  }
  if (currentCommit && report.repo?.commit !== currentCommit) {
    failures.push(`report commit ${report.repo?.commit || 'missing'} does not match ${currentCommit}`);
  }
  if (requireClean && report.repo?.dirty !== false) {
    failures.push('report repo.dirty is not false');
  }

  const requiredResults = REQUIRED_LUMA_WRITE_CLASSES.map((definition) =>
    classResult({
      definition,
      rows,
      expectedSchemaEpoch,
      expectedLumaProfile: expectedLumaProfile || report.luma_profile,
      currentCommit,
    }),
  );

  for (const result of requiredResults) {
    if (result.status !== 'pass') {
      failures.push(result.reason);
    }
  }

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? 'pass' : 'blocked',
    failures: unique(failures),
    required_write_classes: requiredResults,
  };
}

function blockedValidation(reason) {
  return {
    ok: false,
    status: 'blocked',
    failures: [reason],
    required_write_classes: REQUIRED_LUMA_WRITE_CLASSES.map((definition) => ({
      write_class: definition.id,
      label: definition.label,
      status: 'blocked',
      reason,
    })),
  };
}

const localE2eBuildPackages = [
  '@vh/types',
  '@vh/crypto',
  '@vh/luma-sdk',
  '@vh/data-model',
  '@vh/gun-client',
];
let esmResolverRegistered = false;

function runLocalPackageBuilds() {
  for (const packageName of localE2eBuildPackages) {
    const result = spawnSync('pnpm', ['--filter', packageName, 'build'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      throw new Error(`failed to build ${packageName}${output ? `\n${output}` : ''}`);
    }
  }
}

async function registerEsmResolver() {
  if (esmResolverRegistered) {
    return;
  }
  const { register } = await import('node:module');
  register(pathToFileURL(path.join(repoRoot, 'tools/node/esm-resolve-loader.mjs')).href, pathToFileURL(__filename));
  esmResolverRegistered = true;
}

async function loadLocalE2eModules({ skipBuild = false } = {}) {
  if (!skipBuild) {
    runLocalPackageBuilds();
  }
  await registerEsmResolver();
  const importRuntimeModule = (specifier) => import(/* @vite-ignore */ specifier);
  const [forumAdapters, aggregateAdapters, directoryAdapters, newsReportAdapters, dataModel, lumaSdk] = await Promise.all([
    importRuntimeModule(pathToFileURL(path.join(repoRoot, 'packages/gun-client/dist/forumAdapters.js')).href),
    importRuntimeModule(pathToFileURL(path.join(repoRoot, 'packages/gun-client/dist/aggregateAdapters.js')).href),
    importRuntimeModule(pathToFileURL(path.join(repoRoot, 'packages/gun-client/dist/directoryAdapters.js')).href),
    importRuntimeModule(pathToFileURL(path.join(repoRoot, 'packages/gun-client/dist/newsReportAdapters.js')).href),
    importRuntimeModule('@vh/data-model'),
    importRuntimeModule('@vh/luma-sdk'),
  ]);
  const gunClient = {
    ...forumAdapters,
    ...aggregateAdapters,
    ...directoryAdapters,
    ...newsReportAdapters,
  };
  return { gunClient, dataModel, lumaSdk };
}

function createHermeticMeshClient() {
  const store = new Map();
  const writes = [];
  const guardedWrites = [];

  const keyFor = (segments) => segments.join('/');
  const readPath = (segments) => cloneJson(store.get(keyFor(segments)));
  const writePath = (segments, value) => {
    const cloned = cloneJson(value);
    const key = keyFor(segments);
    store.set(key, cloned);
    if (segments.length > 0) {
      const parent = segments.slice(0, -1);
      const childKey = segments.at(-1);
      const parentKey = keyFor(parent);
      const parentValue = store.get(parentKey);
      const parentRecord =
        parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
          ? cloneJson(parentValue)
          : {};
      parentRecord[childKey] = cloned;
      store.set(parentKey, parentRecord);
    }
  };

  const makeNode = (segments) => ({
    get(key) {
      return makeNode([...segments, String(key)]);
    },
    once(callback) {
      callback?.(readPath(segments), segments.at(-1));
    },
    put(value, callback) {
      writes.push({ path: keyFor(segments), value: cloneJson(value) });
      writePath(segments, value);
      callback?.({});
    },
    map() {
      const node = makeNode(segments);
      node.once = (callback) => {
        const value = readPath(segments);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return;
        }
        for (const [key, child] of Object.entries(value)) {
          callback?.(cloneJson(child), key);
        }
      };
      return node;
    },
    off() {},
  });

  const root = makeNode([]);
  const vhRoot = root.get('vh');
  const hydrationBarrier = {
    ready: true,
    async prepare() {},
    markReady() {},
  };
  const topologyGuard = {
    validateWrite(pathName, value) {
      guardedWrites.push({ path: pathName, value: cloneJson(value) });
    },
  };

  return {
    client: {
      gun: {
        get: (key) => root.get(String(key)),
        user: () => ({}),
      },
      mesh: vhRoot,
      hydrationBarrier,
      topologyGuard,
      config: { peers: [] },
      storage: {},
      user: {},
      chat: {},
      outbox: {},
      sessionReady: true,
      markSessionReady() {},
      async linkDevice() {},
      async shutdown() {},
    },
    store,
    writes,
    guardedWrites,
  };
}

async function createEd25519KeyPair() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle API is unavailable');
  }
  const keyPair = await subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new Error('Ed25519 key generation failed');
  }
  const sign = async ({ canonicalBytes }) =>
    toBase64Url(
      new Uint8Array(
        await subtle.sign('Ed25519', keyPair.privateKey, bytesToBufferSource(canonicalBytes)),
      ),
    );
  const verify = ({ canonicalBytes, signature }) =>
    subtle.verify(
      'Ed25519',
      keyPair.publicKey,
      bytesToBufferSource(new Uint8Array(Buffer.from(signature, 'base64url'))),
      bytesToBufferSource(canonicalBytes),
    );
  const publicKeySpki = await subtle.exportKey('spki', keyPair.publicKey);
  return {
    sign,
    verify,
    publicKeySpkiBase64Url: toBase64Url(new Uint8Array(publicKeySpki)),
  };
}

function coverageRow({
  runId,
  writeClass,
  traceSuffix,
  writePath,
  adapterWrite,
  adapterReadback,
  repoCommit,
}) {
  return {
    write_class: writeClass,
    status: 'pass',
    trace_id: `${runId}:${traceSuffix}`,
    writer_kind: 'luma',
    _writerKind: 'luma',
    reader_path: 'luma_reader_path',
    readback_path: 'luma readback',
    schema_epoch: DEFAULT_LUMA_SCHEMA_EPOCH,
    luma_profile: LOCAL_E2E_LUMA_PROFILE,
    repo_commit: repoCommit,
    namespace: writePath,
    adapter_write: adapterWrite,
    adapter_readback: adapterReadback,
  };
}

export function buildLocalE2eCoverageSourceReport({
  runId,
  startedAt,
  completedAt,
  currentCommit,
  branch,
  dirty,
  command = `${LUMA_GATED_WRITE_COVERAGE_COMMAND} -- --mode ${LOCAL_E2E_MODE}`,
  rows,
  failures = [],
  guardedWritePaths = [],
} = {}) {
  const report = {
    schema_version: LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION,
    generated_at: new Date(completedAt).toISOString(),
    run_id: `${runId}-local-e2e-source`,
    repo: {
      branch,
      commit: currentCommit,
      base_ref: 'origin/main',
      dirty,
    },
    run: {
      mode: LOCAL_E2E_MODE,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      command,
    },
    status: failures.length === 0 ? 'pass' : 'blocked',
    schema_epoch: DEFAULT_LUMA_SCHEMA_EPOCH,
    luma_profile: LOCAL_E2E_LUMA_PROFILE,
    coverage_rows: rows,
    local_e2e: {
      hermetic: true,
      profile: LOCAL_E2E_LUMA_PROFILE,
      guarded_write_paths: guardedWritePaths,
      required_write_classes: REQUIRED_LUMA_WRITE_CLASSES.map((definition) => definition.id),
      note: 'Rows are produced from hermetic writes and adapter readbacks in existing LUMA-aware client paths.',
    },
    failures,
  };
  const validation = validateLumaCoverageReport(report, {
    currentCommit,
    requireClean: true,
    expectedSchemaEpoch: DEFAULT_LUMA_SCHEMA_EPOCH,
    expectedLumaProfile: LOCAL_E2E_LUMA_PROFILE,
  });
  return {
    ...report,
    status: validation.ok ? report.status : 'blocked',
    validation,
    failures: unique([...failures, ...validation.failures]),
  };
}

async function createSignedForumThread({ dataModel, lumaSdk, runId }) {
  const keys = await createEd25519KeyPair();
  const issuedAt = 1_777_777_777_000;
  const author = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const payload = {
    schemaVersion: 'hermes-thread-v1',
    _protocolVersion: dataModel.FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: dataModel.FORUM_WRITER_KIND,
    _authorScheme: dataModel.FORUM_AUTHOR_SCHEME,
    id: `thread-${runId}`,
    title: 'Hermetic LUMA coverage thread',
    content: 'Deterministic local reader-path coverage.',
    author,
    timestamp: issuedAt,
    tags: ['luma-coverage'],
    topicId: 'luma-coverage-topic',
  };
  const signedWriteEnvelope = await lumaSdk.createSignedWriteEnvelope({
    profile: LOCAL_E2E_LUMA_PROFILE,
    audience: dataModel.FORUM_THREAD_AUDIENCE,
    origin: 'https://vh.example',
    scheme: dataModel.FORUM_AUTHOR_SCHEME,
    publicAuthor: lumaSdk.createLumaPublicAuthorId(author, dataModel.FORUM_AUTHOR_SCHEME),
    sessionRef: {
      tokenHash: 'a'.repeat(64),
      envelopeDigest: 'b'.repeat(64),
    },
    payload,
    sequence: issuedAt,
    nonce: '00112233445566778899aabbccddeeff',
    issuedAt,
    sign: keys.sign,
  });
  return {
    record: {
      ...payload,
      upvotes: 0,
      downvotes: 0,
      score: 0,
      signedWriteEnvelope,
    },
    verify: keys.verify,
  };
}

async function createSignedForumComment({ dataModel, lumaSdk, runId, threadId }) {
  const keys = await createEd25519KeyPair();
  const issuedAt = 1_777_777_777_001;
  const author = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const payload = {
    schemaVersion: 'hermes-comment-v2',
    _protocolVersion: dataModel.FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: dataModel.FORUM_WRITER_KIND,
    _authorScheme: dataModel.FORUM_AUTHOR_SCHEME,
    id: `comment-${runId}`,
    threadId,
    parentId: null,
    content: 'Hermetic LUMA coverage comment',
    author,
    timestamp: issuedAt,
    stance: 'concur',
  };
  const signedWriteEnvelope = await lumaSdk.createSignedWriteEnvelope({
    profile: LOCAL_E2E_LUMA_PROFILE,
    audience: dataModel.FORUM_COMMENT_AUDIENCE,
    origin: 'https://vh.example',
    scheme: dataModel.FORUM_AUTHOR_SCHEME,
    publicAuthor: lumaSdk.createLumaPublicAuthorId(author, dataModel.FORUM_AUTHOR_SCHEME),
    sessionRef: {
      tokenHash: 'c'.repeat(64),
      envelopeDigest: 'd'.repeat(64),
    },
    payload,
    sequence: issuedAt,
    nonce: '11223344556677889900aabbccddeeff',
    issuedAt,
    sign: keys.sign,
  });
  return {
    record: {
      ...payload,
      upvotes: 0,
      downvotes: 0,
      signedWriteEnvelope,
    },
    verify: keys.verify,
  };
}

async function createSignedAggregateVoterNode({ dataModel, lumaSdk, runId }) {
  const keys = await createEd25519KeyPair();
  const issuedAt = 1_777_777_777_002;
  const voterId = '1111111111111111111111111111111111111111111111111111111111111111';
  const payload = {
    schema_version: dataModel.AGGREGATE_VOTER_NODE_VERSION,
    _protocolVersion: dataModel.AGGREGATE_PUBLIC_PROTOCOL_VERSION,
    _writerKind: dataModel.AGGREGATE_VOTER_WRITER_KIND,
    _authorScheme: dataModel.AGGREGATE_VOTER_AUTHOR_SCHEME,
    topic_id: 'luma-coverage-topic',
    synthesis_id: 'luma-coverage-synthesis',
    epoch: 1,
    voter_id: voterId,
    point_id: `point-${runId}`,
    agreement: 1,
    weight: 1,
    updated_at: '2026-05-09T00:00:00.000Z',
  };
  const signedWriteEnvelope = await lumaSdk.createSignedWriteEnvelope({
    profile: LOCAL_E2E_LUMA_PROFILE,
    audience: dataModel.AGGREGATE_VOTER_AUDIENCE,
    origin: 'https://vh.example',
    scheme: dataModel.AGGREGATE_VOTER_AUTHOR_SCHEME,
    publicAuthor: lumaSdk.createLumaPublicAuthorId(voterId, dataModel.AGGREGATE_VOTER_AUTHOR_SCHEME),
    sessionRef: {
      tokenHash: 'e'.repeat(64),
      envelopeDigest: 'f'.repeat(64),
    },
    payload,
    sequence: issuedAt,
    nonce: '22334455667788990011aabbccddeeff',
    issuedAt,
    sign: keys.sign,
  });
  return {
    record: {
      ...payload,
      signedWriteEnvelope,
    },
    verify: keys.verify,
  };
}

async function createSignedDirectoryEntry({ dataModel, lumaSdk, runId }) {
  const keys = await createEd25519KeyPair();
  const issuedAt = 1_777_777_777_003;
  const identityDirectoryKey = '2222222222222222222222222222222222222222222222222222222222222222';
  const payload = {
    schemaVersion: 'hermes-directory-v1',
    _protocolVersion: dataModel.DIRECTORY_ENTRY_PROTOCOL_VERSION,
    _writerKind: dataModel.DIRECTORY_ENTRY_WRITER_KIND,
    _authorScheme: dataModel.DIRECTORY_ENTRY_AUTHOR_SCHEME,
    identityDirectoryKey,
    devicePub: `device-${runId}`,
    epub: `epub-${runId}`,
    displayName: 'LUMA Coverage',
    delegationSigningPublicKey: {
      signatureSuite: 'jcs-ed25519-sha256-v1',
      publicKey: {
        encoding: 'base64url',
        material: keys.publicKeySpkiBase64Url,
      },
      createdAt: issuedAt,
    },
    registeredAt: issuedAt,
    lastSeenAt: issuedAt + 1,
  };
  const signedWriteEnvelope = await lumaSdk.createSignedWriteEnvelope({
    profile: LOCAL_E2E_LUMA_PROFILE,
    audience: dataModel.DIRECTORY_ENTRY_AUDIENCE,
    origin: 'https://vh.example',
    scheme: dataModel.DIRECTORY_ENTRY_AUTHOR_SCHEME,
    publicAuthor: lumaSdk.createLumaPublicAuthorId(identityDirectoryKey, dataModel.DIRECTORY_ENTRY_AUTHOR_SCHEME),
    sessionRef: {
      tokenHash: '1'.repeat(64),
      envelopeDigest: '2'.repeat(64),
    },
    payload,
    sequence: issuedAt,
    nonce: '33445566778899001122aabbccddeeff',
    issuedAt,
    sign: keys.sign,
  });
  return {
    ...payload,
    signedWriteEnvelope,
  };
}

async function createSignedNewsReport({ dataModel, lumaSdk, runId }) {
  const keys = await createEd25519KeyPair();
  const issuedAt = 1_777_777_777_004;
  const reporterId = '3333333333333333333333333333333333333333333333333333333333333333';
  const signedPayload = dataModel.newsReportSignedPayload({
    schemaVersion: 'hermes-news-report-v2',
    _protocolVersion: dataModel.NEWS_REPORT_PUBLIC_PROTOCOL_VERSION,
    _writerKind: dataModel.NEWS_REPORT_WRITER_KIND,
    _authorScheme: dataModel.NEWS_REPORT_AUTHOR_SCHEME,
    report_id: `report-${runId}`,
    target: {
      type: 'synthesis',
      topic_id: 'luma-coverage-topic',
      synthesis_id: 'luma-coverage-synthesis',
      epoch: 1,
      story_id: 'luma-coverage-story',
    },
    reason_code: 'inaccurate_summary',
    reason: 'Hermetic LUMA reader-path coverage.',
    reporter_id: reporterId,
    created_at: issuedAt,
  });
  const signedWriteEnvelope = await lumaSdk.createSignedWriteEnvelope({
    profile: LOCAL_E2E_LUMA_PROFILE,
    audience: dataModel.NEWS_REPORT_AUDIENCE,
    origin: 'https://vh.example',
    scheme: dataModel.NEWS_REPORT_AUTHOR_SCHEME,
    publicAuthor: lumaSdk.createLumaPublicAuthorId(reporterId, dataModel.NEWS_REPORT_AUTHOR_SCHEME),
    sessionRef: {
      tokenHash: '3'.repeat(64),
      envelopeDigest: '4'.repeat(64),
    },
    payload: signedPayload,
    sequence: issuedAt,
    nonce: '44556677889900112233aabbccddeeff',
    issuedAt,
    sign: keys.sign,
  });
  return {
    ...signedPayload,
    status: 'pending',
    audit: {
      action: 'news_report',
    },
    signedWriteEnvelope,
  };
}

function assertReadback(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runLocalE2eCoverageEvidence({
  runId,
  startedAt,
  currentCommit,
  branch,
  dirty,
  command,
  skipBuild = false,
} = {}) {
  const { gunClient, dataModel, lumaSdk } = await loadLocalE2eModules({ skipBuild });
  const { client, guardedWrites } = createHermeticMeshClient();
  const rows = [];

  const thread = await createSignedForumThread({ dataModel, lumaSdk, runId });
  await gunClient.getForumThreadChain(client, thread.record.id).put(thread.record);
  const threadReadback = await readOnce(gunClient.getForumThreadChain(client, thread.record.id));
  const validatedThread = await gunClient.validateForumThreadRecord(threadReadback, thread.record.id, thread.verify);
  assertReadback(validatedThread?.id === thread.record.id, 'forum thread LUMA readback failed');
  rows.push(coverageRow({
    runId,
    writeClass: 'forum_thread',
    traceSuffix: 'forum-thread',
    writePath: `vh/forum/threads/${thread.record.id}/`,
    adapterWrite: 'getForumThreadChain.put',
    adapterReadback: 'validateForumThreadRecord(getForumThreadChain.once)',
    repoCommit: currentCommit,
  }));

  const comment = await createSignedForumComment({ dataModel, lumaSdk, runId, threadId: thread.record.id });
  await gunClient.getForumCommentsChain(client, thread.record.id).get(comment.record.id).put(comment.record);
  const commentReadback = await readOnce(
    gunClient.getForumCommentsChain(client, thread.record.id).get(comment.record.id),
  );
  const validatedComment = await gunClient.validateForumCommentRecord(
    commentReadback,
    thread.record.id,
    comment.record.id,
    comment.verify,
  );
  assertReadback(validatedComment?.id === comment.record.id, 'forum comment LUMA readback failed');
  rows.push(coverageRow({
    runId,
    writeClass: 'forum_comment',
    traceSuffix: 'forum-comment',
    writePath: `vh/forum/threads/${thread.record.id}/comments/${comment.record.id}/`,
    adapterWrite: 'getForumCommentsChain.get(commentId).put',
    adapterReadback: 'validateForumCommentRecord(getForumCommentsChain.get(commentId).once)',
    repoCommit: currentCommit,
  }));

  const aggregate = await createSignedAggregateVoterNode({ dataModel, lumaSdk, runId });
  await gunClient.writeVoterNode(
    client,
    aggregate.record.topic_id,
    aggregate.record.synthesis_id,
    aggregate.record.epoch,
    aggregate.record.voter_id,
    aggregate.record,
  );
  const aggregateReadback = await gunClient.readAggregateVoterNode(
    client,
    aggregate.record.topic_id,
    aggregate.record.synthesis_id,
    aggregate.record.epoch,
    aggregate.record.voter_id,
    aggregate.record.point_id,
    { readTimeoutMs: 100 },
  );
  const validatedAggregate = await gunClient.validateAggregateVoterNodeRecord(
    aggregateReadback,
    {
      topicId: aggregate.record.topic_id,
      synthesisId: aggregate.record.synthesis_id,
      epoch: aggregate.record.epoch,
      voterId: aggregate.record.voter_id,
      pointId: aggregate.record.point_id,
    },
    aggregate.verify,
  );
  assertReadback(validatedAggregate?.voter_id === aggregate.record.voter_id, 'aggregate voter LUMA readback failed');
  rows.push(coverageRow({
    runId,
    writeClass: 'vote_or_aggregate',
    traceSuffix: 'vote-or-aggregate',
    writePath: `vh/aggregates/topics/${aggregate.record.topic_id}/syntheses/${aggregate.record.synthesis_id}/epochs/${aggregate.record.epoch}/voters/${aggregate.record.voter_id}/${aggregate.record.point_id}/`,
    adapterWrite: 'writeVoterNode',
    adapterReadback: 'readAggregateVoterNode + validateAggregateVoterNodeRecord',
    repoCommit: currentCommit,
  }));

  const directoryEntry = await createSignedDirectoryEntry({ dataModel, lumaSdk, runId });
  await gunClient.publishToDirectory(client, directoryEntry);
  const directoryReadback = await gunClient.lookupByIdentityDirectoryKey(client, directoryEntry.identityDirectoryKey);
  assertReadback(
    directoryReadback?.identityDirectoryKey === directoryEntry.identityDirectoryKey,
    'directory publish LUMA readback failed',
  );
  rows.push(coverageRow({
    runId,
    writeClass: 'directory_publish',
    traceSuffix: 'directory-publish',
    writePath: `vh/directory/${directoryEntry.identityDirectoryKey}/`,
    adapterWrite: 'publishToDirectory',
    adapterReadback: 'lookupByIdentityDirectoryKey',
    repoCommit: currentCommit,
  }));

  const newsReport = await createSignedNewsReport({ dataModel, lumaSdk, runId });
  await gunClient.writeNewsReport(client, newsReport);
  const newsReportReadback = await gunClient.readNewsReport(client, newsReport.report_id);
  const pendingReports = await gunClient.readNewsReportsByStatus(client, 'pending');
  assertReadback(newsReportReadback?.report_id === newsReport.report_id, 'news report LUMA readback failed');
  assertReadback(
    pendingReports.some((report) => report.report_id === newsReport.report_id),
    'news report status-index LUMA readback failed',
  );
  rows.push(coverageRow({
    runId,
    writeClass: 'news_report_status',
    traceSuffix: 'news-report-status',
    writePath: `vh/news/reports/${newsReport.report_id}/`,
    adapterWrite: 'writeNewsReport',
    adapterReadback: 'readNewsReport + readNewsReportsByStatus',
    repoCommit: currentCommit,
  }));

  return buildLocalE2eCoverageSourceReport({
    runId,
    startedAt,
    completedAt: Date.now(),
    currentCommit,
    branch,
    dirty,
    command,
    rows,
    guardedWritePaths: unique(guardedWrites.map((entry) => entry.path)),
  });
}

export function buildLumaCoverageReport({
  runId,
  startedAt,
  completedAt,
  command = LUMA_GATED_WRITE_COVERAGE_COMMAND,
  currentCommit,
  branch,
  dirty,
  sourceReport = null,
  sourceReportPath = null,
  sourceReadFailure = null,
  expectedSchemaEpoch = DEFAULT_LUMA_SCHEMA_EPOCH,
  expectedLumaProfile = null,
} = {}) {
  const validation = sourceReadFailure
    ? blockedValidation(sourceReadFailure)
    : sourceReport
      ? validateLumaCoverageReport(sourceReport, {
          currentCommit,
          requireClean: true,
          expectedSchemaEpoch,
          expectedLumaProfile,
        })
      : blockedValidation('luma_profile is none and no LUMA reader-path coverage report was provided');

  const lumaProfile = sourceReport?.luma_profile || expectedLumaProfile || 'none';
  const status = validation.ok ? 'pass' : 'blocked';

  return {
    schema_version: LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION,
    generated_at: new Date(completedAt).toISOString(),
    run_id: runId,
    repo: {
      branch,
      commit: currentCommit,
      base_ref: 'origin/main',
      dirty,
    },
    run: {
      mode: LUMA_GATED_WRITE_COVERAGE_MODE,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      command,
    },
    status,
    schema_epoch: expectedSchemaEpoch,
    luma_profile: lumaProfile,
    coverage_source_report_path: sourceReportPath,
    luma_gated_write_coverage: {
      status,
      command,
      expected_schema_epoch: expectedSchemaEpoch,
      expected_luma_profile: expectedLumaProfile,
      source_report_path: sourceReportPath,
      failures: validation.failures,
      required_write_classes: validation.required_write_classes,
    },
    luma_gated_write_drills: validation.required_write_classes.map((result) => ({
      write_class: result.write_class,
      trace_id: result.trace_id || runId,
      status: result.status === 'pass' ? 'pass' : 'skipped',
      reason: result.reason,
      writer_kind: result.writer_kind || null,
      reader_path: result.reader_path || null,
      schema_epoch: result.schema_epoch || expectedSchemaEpoch,
      luma_profile: result.luma_profile || lumaProfile,
    })),
    release_claims: {
      allowed: validation.ok
        ? ['All required LUMA-gated write classes have current LUMA reader-path coverage evidence.']
        : [],
      forbidden: [
        'LUMA gate behavior is verified by mesh.',
        ...(validation.ok ? [] : ['LUMA-gated production write classes are mesh-readiness-proven.']),
      ],
      invalidated_by_luma_epoch_change: false,
    },
    failures: validation.failures,
  };
}

function parseArgs(argv) {
  const args = {
    mode: process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_MODE || null,
    sourceReport: process.env[LUMA_GATED_WRITE_COVERAGE_REPORT_ENV] || null,
    expectedSchemaEpoch: process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_SCHEMA_EPOCH || DEFAULT_LUMA_SCHEMA_EPOCH,
    expectedLumaProfile: process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_LUMA_PROFILE || null,
    skipBuild: process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_SKIP_BUILD === 'true',
  };
  const tokens = argv.filter((token) => token !== '--');
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--source-report' || token === '--evidence-report') {
      args.sourceReport = tokens[++index] || null;
    } else if (token === '--mode') {
      args.mode = tokens[++index] || null;
    } else if (token === '--local-e2e') {
      args.mode = LOCAL_E2E_MODE;
    } else if (token === '--skip-build') {
      args.skipBuild = true;
    } else if (token === '--expected-schema-epoch') {
      args.expectedSchemaEpoch = tokens[++index] || args.expectedSchemaEpoch;
    } else if (token === '--expected-luma-profile') {
      args.expectedLumaProfile = tokens[++index] || null;
    } else {
      throw new Error(`unknown argument ${token}`);
    }
  }
  return args;
}

function resolveMaybeRelative(filePath) {
  return filePath ? path.resolve(repoRoot, filePath) : null;
}

async function main() {
  const startedAt = Date.now();
  const runId = makeId('mesh-luma-gated-write-coverage');
  const args = parseArgs(process.argv.slice(2));
  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = runGit(['status', '--short']).length > 0;
  const resolvedSourcePath = resolveMaybeRelative(args.sourceReport);
  let sourceReport = null;
  let sourceReadFailure = null;
  const command = commandText(process.argv.slice(2));

  if (args.mode && args.mode !== LOCAL_E2E_MODE) {
    sourceReadFailure = `unsupported LUMA coverage mode ${args.mode}`;
  } else if (args.mode === LOCAL_E2E_MODE && resolvedSourcePath) {
    sourceReadFailure = 'local-e2e mode does not accept --source-report';
  } else if (args.mode === LOCAL_E2E_MODE) {
    try {
      sourceReport = await runLocalE2eCoverageEvidence({
        runId,
        startedAt,
        currentCommit,
        branch,
        dirty,
        command,
        skipBuild: args.skipBuild,
      });
    } catch (error) {
      sourceReadFailure = `local E2E LUMA coverage failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else if (resolvedSourcePath) {
    try {
      sourceReport = readJson(resolvedSourcePath);
    } catch (error) {
      sourceReadFailure = `failed to read LUMA coverage source report: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const completedAt = Date.now();
  const report = buildLumaCoverageReport({
    runId,
    startedAt,
    completedAt,
    currentCommit,
    branch,
    dirty,
    command,
    sourceReport,
    sourceReportPath: resolvedSourcePath,
    sourceReadFailure,
    expectedSchemaEpoch: args.expectedSchemaEpoch,
    expectedLumaProfile: args.expectedLumaProfile || (args.mode === LOCAL_E2E_MODE ? LOCAL_E2E_LUMA_PROFILE : null),
  });

  const runDir = path.join(artifactRoot, runId);
  const reportPath = path.join(runDir, LUMA_GATED_WRITE_COVERAGE_REPORT_NAME);
  writeJson(reportPath, report);
  copyDir(runDir, latestDir);

  console.log(JSON.stringify({
    ok: report.status === 'pass',
    status: report.status,
    run_id: runId,
    report_path: reportPath,
    latest_report_path: path.join(latestDir, LUMA_GATED_WRITE_COVERAGE_REPORT_NAME),
    schema_epoch: report.schema_epoch,
    luma_profile: report.luma_profile,
    failures: report.failures,
  }, null, 2));

  if (report.status !== 'pass') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
