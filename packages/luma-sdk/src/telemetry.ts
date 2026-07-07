export const LUMA_TELEMETRY_EVENT_TYPES = Object.freeze([
  'luma_session_created',
  'luma_session_expired',
  'luma_session_re_attested',
  'luma_session_revoked',
  'luma_session_revoked_by_bulletin',
  'luma_policy_blocked',
  'luma_envelope_rejected',
  'luma_tombstone_attempted',
  'luma_evidence_capture_started',
  'luma_evidence_capture_succeeded',
  'luma_evidence_capture_failed',
  'luma_forbidden_claim_rendered',
  'luma_safety_bulletin_fetched',
  'luma_vault_migrated_v1_to_v2',
] as const);

export type LumaTelemetryEventType = typeof LUMA_TELEMETRY_EVENT_TYPES[number];
export type LumaTelemetryLevel = 'info' | 'warn' | 'error';
export type LumaTelemetryPrimitive = string | number | boolean | null;
export type LumaTelemetryValue =
  | LumaTelemetryPrimitive
  | readonly LumaTelemetryValue[]
  | { readonly [key: string]: LumaTelemetryValue };
export type LumaTelemetryContext = Record<string, LumaTelemetryValue>;
export type LumaRedactedLogValue =
  | LumaTelemetryPrimitive
  | undefined
  | readonly LumaRedactedLogValue[]
  | { readonly [key: string]: LumaRedactedLogValue };

export interface LumaEvent {
  readonly sequence: number;
  readonly type: LumaTelemetryEventType;
  readonly level: LumaTelemetryLevel;
  readonly ts_ms: number;
  readonly message?: string;
  readonly context?: LumaTelemetryContext;
}

export interface EmitLumaEventInput {
  readonly type: LumaTelemetryEventType;
  readonly level?: LumaTelemetryLevel;
  readonly tsMs?: number;
  readonly message?: string;
  readonly context?: LumaTelemetryContext;
}

export interface LumaTelemetryStore {
  readonly emit: (input: EmitLumaEventInput) => LumaEvent;
  readonly getSnapshot: () => readonly LumaEvent[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly clear: (options?: { readonly rotateSalt?: boolean }) => void;
  readonly rotateSalt: () => void;
  readonly redactedPathHash: (rawPath: string) => Promise<string>;
}

const LUMA_TELEMETRY_EVENT_TYPE_SET = new Set<string>(LUMA_TELEMETRY_EVENT_TYPES);
const DEFAULT_MAX_EVENTS = 1000;
const SALT_BYTES = 16;
const TEXT_ENCODER = new TextEncoder();
const FORBIDDEN_FIELD_NAMES = Object.freeze([
  'nullifier',
  'principalNullifier',
  'activeNullifier',
  'deviceCredential',
  'sessionToken',
  'rawSignatureBytes',
  'rawEnvelopeJson',
  'assuranceEnvelope',
  'envelope',
  'signature',
  'verifierId',
  'district_hash',
  'districtHash',
  'region_code',
  'regionCode',
  'vaultMasterKey',
  'privateKey',
  'secretKey',
  // Account-provider identity/token material (Apple/Google/X sign-in).
  // Normalization makes each entry cover camelCase and snake_case forms.
  'accessToken',
  'refreshToken',
  'idToken',
  'providerSubject',
  'providerLabel',
  'displayLabel',
  'clientSecret',
  'oauthCode',
] as const);
const FORBIDDEN_FIELD_NAME_SET = new Set(FORBIDDEN_FIELD_NAMES.map(normalizeFieldName));
const TOKEN_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'session_token',
  'auth_token',
  'oauth_token',
  'bearer_token',
  'pin',
  'key',
  'secret',
]);
const RAW_MESH_PATH_PATTERN = /(?:^|[\s"'`])\/?vh\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/;
const RAW_ENVELOPE_JSON_PATTERN = /"envelopeVersion"\s*:\s*\d+[\s\S]*"signature"\s*:/;

function normalizeFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function assertKnownEventType(type: string): asserts type is LumaTelemetryEventType {
  if (!LUMA_TELEMETRY_EVENT_TYPE_SET.has(type)) {
    throw new Error(`Unknown LUMA telemetry event type: ${type}`);
  }
}

function fieldNameForbidden(fieldName: string): boolean {
  return FORBIDDEN_FIELD_NAME_SET.has(normalizeFieldName(fieldName));
}

function looksLikeTokenUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    for (const key of parsed.searchParams.keys()) {
      if (TOKEN_QUERY_KEYS.has(key.toLowerCase())) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function stringForbiddenReason(value: string): string | null {
  if (RAW_MESH_PATH_PATTERN.test(value)) {
    return 'raw mesh path';
  }
  if (looksLikeTokenUrl(value)) {
    return 'token-bearing URL';
  }
  if (RAW_ENVELOPE_JSON_PATTERN.test(value)) {
    return 'raw envelope JSON';
  }
  return null;
}

function assertTelemetryValueSafe(value: unknown, path: string, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    const reason = stringForbiddenReason(value);
    if (reason) {
      throw new Error(`LUMA telemetry context contains forbidden ${reason} at ${path}`);
    }
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTelemetryValueSafe(item, `${path}[${index}]`, seen));
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (fieldNameForbidden(key)) {
      throw new Error(`LUMA telemetry context contains forbidden field "${key}" at ${nestedPath}`);
    }
    assertTelemetryValueSafe(nested, nestedPath, seen);
  }
}

export function assertLumaTelemetrySafe(value: unknown): void {
  assertTelemetryValueSafe(value, '$', new WeakSet<object>());
}

function redactString(value: string): string {
  if (RAW_MESH_PATH_PATTERN.test(value)) {
    return '[REDACTED:mesh-path]';
  }
  if (looksLikeTokenUrl(value)) {
    return '[REDACTED:token-url]';
  }
  if (RAW_ENVELOPE_JSON_PATTERN.test(value)) {
    return '[REDACTED:envelope-json]';
  }
  return value;
}

function sanitizeForLog(value: unknown, seen: WeakSet<object>): LumaRedactedLogValue {
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
    };
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (seen.has(value)) {
    return '[REDACTED:circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, seen));
  }

  const redacted: Record<string, LumaRedactedLogValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = fieldNameForbidden(key)
      ? '[REDACTED:field]'
      : sanitizeForLog(nested, seen);
  }
  return redacted;
}

export function redactLumaTelemetryContext(context: unknown): LumaRedactedLogValue {
  return sanitizeForLog(context, new WeakSet<object>());
}

function randomSaltBytes(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(salt);
    return salt;
  }
  for (let index = 0; index < salt.length; index += 1) {
    salt[index] = Math.floor(Math.random() * 256);
  }
  return salt;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto SHA-256 is required for LUMA redactedPathHash');
  }
  const digestInput = new Uint8Array(bytes).buffer as ArrayBuffer;
  const digest = await cryptoApi.subtle.digest('SHA-256', digestInput);
  return bytesToHex(new Uint8Array(digest));
}

export function createLumaTelemetryStore(options: {
  readonly maxEvents?: number;
  readonly saltBytes?: Uint8Array;
} = {}): LumaTelemetryStore {
  const maxEvents = Math.max(1, Math.floor(options.maxEvents ?? DEFAULT_MAX_EVENTS));
  const listeners = new Set<() => void>();
  let events: LumaEvent[] = [];
  let sequence = 0;
  let saltBytes = options.saltBytes ? new Uint8Array(options.saltBytes) : randomSaltBytes();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    emit(input: EmitLumaEventInput): LumaEvent {
      assertKnownEventType(input.type);
      if (input.message !== undefined) {
        assertLumaTelemetrySafe(input.message);
      }
      if (input.context) {
        assertLumaTelemetrySafe(input.context);
      }
      const event: LumaEvent = Object.freeze({
        sequence: sequence += 1,
        type: input.type,
        level: input.level ?? 'info',
        ts_ms: input.tsMs ?? Date.now(),
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.context ? { context: Object.freeze({ ...input.context }) } : {}),
      });
      events = [...events, event].slice(-maxEvents);
      notify();
      return event;
    },
    getSnapshot(): readonly LumaEvent[] {
      return events;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear(optionsForClear: { readonly rotateSalt?: boolean } = {}): void {
      events = [];
      if (optionsForClear.rotateSalt !== false) {
        saltBytes = randomSaltBytes();
      }
      notify();
    },
    rotateSalt(): void {
      saltBytes = randomSaltBytes();
      notify();
    },
    async redactedPathHash(rawPath: string): Promise<string> {
      const reason = stringForbiddenReason(rawPath);
      if (!reason && !rawPath.trim()) {
        throw new Error('redactedPathHash requires a non-empty raw path');
      }
      const digest = await sha256Hex(concatBytes(saltBytes, TEXT_ENCODER.encode(rawPath)));
      return `sha256:${digest}`;
    },
  };
}

export const lumaTelemetryStore = createLumaTelemetryStore();

export function emitLumaEvent(input: EmitLumaEventInput): LumaEvent {
  return lumaTelemetryStore.emit(input);
}

export function clearLumaTelemetry(options?: { readonly rotateSalt?: boolean }): void {
  lumaTelemetryStore.clear(options);
}

export async function redactedPathHash(rawPath: string): Promise<string> {
  return lumaTelemetryStore.redactedPathHash(rawPath);
}

export function lumaLog(level: LumaTelemetryLevel, message: string, context?: unknown): void {
  const consoleForRuntime = globalThis.console;
  if (!consoleForRuntime) {
    return;
  }
  const sink =
    level === 'error'
      ? consoleForRuntime.error
      : level === 'warn'
        ? consoleForRuntime.warn
        : consoleForRuntime.info;
  const redactedMessage = redactString(message);
  if (context === undefined) {
    sink.call(consoleForRuntime, redactedMessage);
    return;
  }
  sink.call(consoleForRuntime, redactedMessage, redactLumaTelemetryContext(context));
}
