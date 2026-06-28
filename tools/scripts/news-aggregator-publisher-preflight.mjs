#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function explicitlyFalse(value) {
  return /^(0|false|no|off)$/i.test(String(value ?? '').trim());
}

function parseDelimited(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return [];
  }
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.flatMap(parseDelimited) : [];
    } catch {
      return [];
    }
  }
  return raw.split(/[,\n]+/).map((entry) => entry.trim()).filter(Boolean);
}

function validUrl(value, label, failures) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
      failures.push(`${label}:unsupported_protocol`);
      return null;
    }
    return url;
  } catch {
    failures.push(`${label}:invalid_url`);
    return null;
  }
}

function relayHealthUrlFromPeer(peer, failures) {
  const parsed = validUrl(peer, 'gun_peer', failures);
  if (!parsed) {
    return null;
  }
  if (parsed.protocol === 'ws:') {
    parsed.protocol = 'http:';
  } else if (parsed.protocol === 'wss:') {
    parsed.protocol = 'https:';
  }
  parsed.pathname = '/healthz';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function relayRestWriteUrlFromOrigin(origin, path, label, failures) {
  const parsed = validUrl(origin, label, failures);
  if (!parsed) {
    return null;
  }
  if (parsed.protocol === 'ws:') {
    parsed.protocol = 'http:';
  } else if (parsed.protocol === 'wss:') {
    parsed.protocol = 'https:';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    failures.push(`${label}:unsupported_protocol`);
    return null;
  }
  parsed.pathname = path;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function assertPresent(env, name, failures) {
  if (!firstNonEmpty(env[name])) {
    failures.push(`${name}:missing`);
    return false;
  }
  return true;
}

function normalizeRelayTokenOrigin(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:';
    } else if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:';
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.origin;
  } catch {
    return null;
  }
}

function addRelayTokenMapEntry(map, origin, token, sourceName, failures) {
  const normalizedOrigin = normalizeRelayTokenOrigin(String(origin ?? '').trim());
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedOrigin || !normalizedToken) {
    failures.push(`${sourceName}:invalid_entry`);
    return;
  }
  if (!map.has(normalizedOrigin)) {
    map.set(normalizedOrigin, normalizedToken);
  }
}

function parseRelayTokenMapValue(value, sourceName, failures) {
  const map = new Map();
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return map;
  }

  if (trimmed.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      failures.push(`${sourceName}:invalid_json`);
      return map;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      failures.push(`${sourceName}:expected_object`);
      return map;
    }
    for (const [origin, token] of Object.entries(parsed)) {
      addRelayTokenMapEntry(map, origin, token, sourceName, failures);
    }
    return map;
  }

  if (trimmed.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      failures.push(`${sourceName}:invalid_json`);
      return map;
    }
    if (!Array.isArray(parsed)) {
      failures.push(`${sourceName}:expected_array`);
      return map;
    }
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        const separator = entry.indexOf('=');
        if (separator <= 0) {
          failures.push(`${sourceName}:invalid_entry`);
          continue;
        }
        addRelayTokenMapEntry(map, entry.slice(0, separator), entry.slice(separator + 1), sourceName, failures);
        continue;
      }
      if (entry && typeof entry === 'object') {
        addRelayTokenMapEntry(map, entry.origin ?? entry.url, entry.token, sourceName, failures);
        continue;
      }
      failures.push(`${sourceName}:invalid_entry`);
    }
    return map;
  }

  for (const entry of trimmed.split(/[,\n]+/).map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      failures.push(`${sourceName}:invalid_entry`);
      continue;
    }
    addRelayTokenMapEntry(map, entry.slice(0, separator), entry.slice(separator + 1), sourceName, failures);
  }
  return map;
}

function readRelayTokenMap(env, names, failures) {
  const merged = new Map();
  for (const name of names) {
    const raw = firstNonEmpty(env[name]);
    if (!raw) {
      continue;
    }
    const parsed = parseRelayTokenMapValue(raw, name, failures);
    for (const [origin, token] of parsed) {
      if (!merged.has(origin)) {
        merged.set(origin, token);
      }
    }
  }
  return merged;
}

function relayTokenForUrl(url, tokenMap, fallbackToken) {
  const origin = new URL(url).origin;
  return tokenMap.get(origin) ?? fallbackToken;
}

function parseMinSuccess(value, failurePrefix, endpointCount, failures) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return { configured: false, value: null };
  }
  if (!/^[0-9]+$/.test(raw)) {
    failures.push(`${failurePrefix}:invalid`);
    return { configured: true, value: null };
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    failures.push(`${failurePrefix}:invalid`);
    return { configured: true, value: null };
  }
  if (parsed > endpointCount) {
    failures.push(`${failurePrefix}:impossible:${parsed}_gt_${endpointCount}`);
  }
  return { configured: true, value: parsed };
}

function relayRequiredSuccessCount({
  active,
  endpointCount,
  minSuccessRaw,
  requireAll,
  failurePrefix,
  failures,
}) {
  const parsed = parseMinSuccess(minSuccessRaw, failurePrefix, endpointCount, failures);
  if (!active || endpointCount <= 0) {
    return {
      min_success: parsed.value,
      min_success_configured: parsed.configured,
      endpoint_count: endpointCount,
      required_success_count: 0,
    };
  }
  if (parsed.configured) {
    return {
      min_success: parsed.value,
      min_success_configured: true,
      endpoint_count: endpointCount,
      required_success_count: parsed.value ?? 0,
    };
  }
  return {
    min_success: null,
    min_success_configured: false,
    endpoint_count: endpointCount,
    required_success_count: requireAll ? endpointCount : 1,
  };
}

function collectMissingRelayTokens({
  failures,
  failurePrefix,
  urls,
  tokenMap,
  fallbackToken,
}) {
  const tokensByUrl = new Map();
  for (const url of urls) {
    const origin = new URL(url).origin;
    const token = relayTokenForUrl(url, tokenMap, fallbackToken);
    if (!token) {
      failures.push(`${failurePrefix}:${origin}:missing`);
      continue;
    }
    tokensByUrl.set(url, token);
  }
  return tokensByUrl;
}

async function probeNewsRelayRestAuth(url, token, fetchFn) {
  const parsed = new URL(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchFn(parsed, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return {
      origin: parsed.origin,
      status: response.status,
      authenticated: response.status === 400 && /required|invalid/i.test(String(body?.error ?? '')),
      error: typeof body?.error === 'string' ? body.error : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runNewsAggregatorPublisherPreflight({
  env = process.env,
  fetchFn = globalThis.fetch,
} = {}) {
  const failures = [];
  const writerIdPresent = Boolean(firstNonEmpty(env.VH_NEWS_SYSTEM_WRITER_ID, env.VH_SYSTEM_WRITER_ID));
  const pinPresent = Boolean(firstNonEmpty(env.VH_NEWS_SYSTEM_WRITER_PIN_JSON, env.VH_SYSTEM_WRITER_PIN_JSON));
  const publicKeyPresent = Boolean(firstNonEmpty(
    env.VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL,
    env.VH_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL,
  ));
  const privateKeyPresent = Boolean(firstNonEmpty(
    env.VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL,
    env.VH_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL,
  ));

  if (!writerIdPresent) failures.push('system_writer_id:missing');
  if (!privateKeyPresent) failures.push('system_writer_private_key:missing');
  if (!pinPresent && !publicKeyPresent) failures.push('system_writer_pin_or_public_key:missing');

  assertPresent(env, 'VH_STORYCLUSTER_REMOTE_URL', failures);
  assertPresent(env, 'VH_STORYCLUSTER_REMOTE_HEALTH_URL', failures);
  assertPresent(env, 'VH_STORYCLUSTER_REMOTE_AUTH_TOKEN', failures);

  const gunPeers = parseDelimited(firstNonEmpty(env.VH_GUN_PEERS, env.VITE_GUN_PEERS));
  if (gunPeers.length === 0) {
    failures.push('gun_peers:missing');
  }
  for (const peer of gunPeers) {
    validUrl(peer, 'gun_peer', failures);
  }

  const configuredRelayHealthUrls = parseDelimited(env.VH_NEWS_PUBLISHER_RELAY_HEALTH_URLS);
  const relayHealthUrls = configuredRelayHealthUrls.length > 0
    ? configuredRelayHealthUrls
    : [...new Set(gunPeers.map((peer) => relayHealthUrlFromPeer(peer, failures)).filter(Boolean))];
  if (relayHealthUrls.length === 0) {
    failures.push('relay_read_health_urls:missing');
  }

  const scopeBEnrichmentEnabled = truthy(env.VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED);
  const synthesisConfigured = explicitlyFalse(env.VH_BUNDLE_SYNTHESIS_ENABLED)
    ? false
    : truthy(env.VH_BUNDLE_SYNTHESIS_ENABLED)
      || Boolean(firstNonEmpty(env.VH_BUNDLE_SYNTHESIS_API_KEY, env.ANALYSIS_RELAY_API_KEY, env.OPENAI_API_KEY));
  const synthesisEnabled = scopeBEnrichmentEnabled && synthesisConfigured;
  const storylinesEnabled = scopeBEnrichmentEnabled && !explicitlyFalse(env.VH_NEWS_STORYLINES_ENABLED);
  const relayRestOrigins = parseDelimited(env.VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS);
  const relayRestWriteRequested = truthy(env.VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST)
    || relayRestOrigins.length > 0;
  const newsRelayRestOrigins = parseDelimited(env.VH_NEWS_RELAY_REST_WRITE_ORIGINS);
  const newsRelayRestWriteFirst = truthy(env.VH_NEWS_RELAY_REST_WRITE_FIRST);
  const newsRelayRestRequireAll = !explicitlyFalse(env.VH_NEWS_RELAY_REST_WRITE_REQUIRE_ALL);
  const synthesisRelayRestRequireAll = !explicitlyFalse(env.VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL);
  const fallbackRelayDaemonToken = firstNonEmpty(env.VH_RELAY_DAEMON_TOKEN);
  const newsRelayRestTokenMap = readRelayTokenMap(
    env,
    ['VH_NEWS_RELAY_REST_WRITE_TOKENS', 'VITE_VH_NEWS_RELAY_REST_WRITE_TOKENS'],
    failures,
  );
  const synthesisRelayRestTokenMap = readRelayTokenMap(
    env,
    [
      'VH_BUNDLE_SYNTHESIS_RELAY_WRITE_TOKENS',
      'VH_NEWS_RELAY_REST_WRITE_TOKENS',
      'VITE_VH_BUNDLE_SYNTHESIS_RELAY_WRITE_TOKENS',
      'VITE_VH_NEWS_RELAY_REST_WRITE_TOKENS',
    ],
    failures,
  );
  const newsRelayRestWriteOriginInputs = newsRelayRestWriteFirst
    ? (
        newsRelayRestOrigins.length > 0
          ? newsRelayRestOrigins
          : relayRestOrigins.length > 0
            ? relayRestOrigins
            : gunPeers
      )
    : [];
  const newsRelayRestWriteAuthUrls = newsRelayRestWriteFirst
    ? [...new Set(newsRelayRestWriteOriginInputs
      .map((origin) => relayRestWriteUrlFromOrigin(origin, '/vh/news/story', 'relay_rest_news_origin', failures))
      .filter(Boolean))]
    : [];
  const synthesisRelayRestAuthUrls = [...new Set(relayRestOrigins
    .map((origin) => relayRestWriteUrlFromOrigin(
      origin,
      '/vh/topics/synthesis',
      'relay_rest_synthesis_origin',
      failures,
    ))
    .filter(Boolean))];
  const newsRelayRestQuorum = relayRequiredSuccessCount({
    active: newsRelayRestWriteFirst,
    endpointCount: newsRelayRestWriteAuthUrls.length,
    minSuccessRaw: firstNonEmpty(
      env.VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS,
      env.VITE_VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS,
    ),
    requireAll: newsRelayRestRequireAll,
    failurePrefix: 'relay_rest_news_min_success',
    failures,
  });
  const synthesisRelayRestQuorum = relayRequiredSuccessCount({
    active: synthesisEnabled,
    endpointCount: synthesisRelayRestAuthUrls.length,
    minSuccessRaw: env.VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS,
    requireAll: synthesisRelayRestRequireAll,
    failurePrefix: 'relay_rest_synthesis_min_success',
    failures,
  });
  const synthesisRelayTokensByUrl = collectMissingRelayTokens({
    failures,
    failurePrefix: 'relay_rest_synthesis_token',
    urls: synthesisEnabled ? synthesisRelayRestAuthUrls : [],
    tokenMap: synthesisRelayRestTokenMap,
    fallbackToken: fallbackRelayDaemonToken,
  });
  const newsRelayTokensByUrl = collectMissingRelayTokens({
    failures,
    failurePrefix: 'relay_rest_news_token',
    urls: newsRelayRestWriteFirst ? newsRelayRestWriteAuthUrls : [],
    tokenMap: newsRelayRestTokenMap,
    fallbackToken: fallbackRelayDaemonToken,
  });
  if (synthesisEnabled) {
    if (!relayRestWriteRequested) failures.push('relay_rest_synthesis:disabled_while_synthesis_enabled');
    if (relayRestOrigins.length === 0) failures.push('relay_rest_synthesis_origins:missing');
    if (!fallbackRelayDaemonToken && synthesisRelayRestTokenMap.size === 0) {
      failures.push('relay_rest_synthesis_token:missing');
    }
    for (const origin of relayRestOrigins) {
      const url = validUrl(origin, 'relay_rest_synthesis_origin', failures);
      if (url && !['http:', 'https:'].includes(url.protocol)) {
        failures.push('relay_rest_synthesis_origin:unsupported_protocol');
      }
    }
  }
  if (newsRelayRestWriteFirst) {
    if (!fallbackRelayDaemonToken && newsRelayRestTokenMap.size === 0) {
      failures.push('relay_rest_news_token:missing');
    }
    if (newsRelayRestWriteAuthUrls.length === 0) {
      failures.push('relay_rest_news_auth_targets:missing');
    }
  }

  const relayResults = [];
  const newsRelayRestAuthResults = [];
  if (failures.length === 0) {
    if (typeof fetchFn !== 'function') {
      failures.push('fetch:unavailable');
    } else {
      for (const url of relayHealthUrls) {
        const parsed = validUrl(url, 'relay_read_health_url', failures);
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
          failures.push('relay_read_health_url:unsupported_protocol');
          continue;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetchFn(parsed, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          });
          relayResults.push({ origin: parsed.origin, status: response.status, ok: response.ok });
          if (!response.ok) {
            failures.push(`relay_read_health:${parsed.origin}:http_${response.status}`);
          }
        } catch (error) {
          failures.push(`relay_read_health:${parsed.origin}:${error instanceof Error ? error.message : String(error)}`);
        } finally {
          clearTimeout(timeout);
        }
      }
      if (newsRelayRestWriteFirst) {
        for (const url of newsRelayRestWriteAuthUrls) {
          const token = newsRelayTokensByUrl.get(url);
          if (!token) {
            continue;
          }
          try {
            const result = await probeNewsRelayRestAuth(url, token, fetchFn);
            newsRelayRestAuthResults.push(result);
            if (!result.authenticated) {
              failures.push(`relay_rest_news_auth:${result.origin}:http_${result.status}`);
            }
          } catch (error) {
            const origin = new URL(url).origin;
            failures.push(`relay_rest_news_auth:${origin}:${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
  }

  return {
    stage: 'raw_publication_readiness',
    status: failures.length === 0 ? 'pass' : 'fail',
    no_write: env.VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE === '1',
    signer_material: {
      writer_id_present: writerIdPresent,
      pin_present: pinPresent,
      public_key_present: publicKeyPresent,
      private_key_present: privateKeyPresent,
    },
    gun_peer_count: gunPeers.length,
    relay_health_target_count: relayHealthUrls.length,
    relay_health_results: relayResults,
    storycluster_config_present: {
      endpoint: Boolean(firstNonEmpty(env.VH_STORYCLUSTER_REMOTE_URL)),
      health: Boolean(firstNonEmpty(env.VH_STORYCLUSTER_REMOTE_HEALTH_URL)),
      auth_token: Boolean(firstNonEmpty(env.VH_STORYCLUSTER_REMOTE_AUTH_TOKEN)),
    },
    scope_b_enrichment_enabled: scopeBEnrichmentEnabled,
    synthesis_configured: synthesisConfigured,
    synthesis_enabled: synthesisEnabled,
    storylines_enabled: storylinesEnabled,
    relay_rest_synthesis: {
      requested: relayRestWriteRequested,
      origin_count: relayRestOrigins.length,
      endpoint_count: synthesisRelayRestQuorum.endpoint_count,
      require_all: synthesisRelayRestRequireAll,
      min_success: synthesisRelayRestQuorum.min_success,
      min_success_configured: synthesisRelayRestQuorum.min_success_configured,
      required_success_count: synthesisRelayRestQuorum.required_success_count,
      daemon_token_present: Boolean(fallbackRelayDaemonToken),
      per_origin_token_count: synthesisRelayRestTokenMap.size,
      all_target_tokens_present: synthesisEnabled
        ? synthesisRelayTokensByUrl.size === synthesisRelayRestAuthUrls.length
        : true,
    },
    relay_rest_news_publication: {
      write_first: newsRelayRestWriteFirst,
      origin_count: newsRelayRestWriteAuthUrls.length,
      endpoint_count: newsRelayRestQuorum.endpoint_count,
      require_all: newsRelayRestRequireAll,
      min_success: newsRelayRestQuorum.min_success,
      min_success_configured: newsRelayRestQuorum.min_success_configured,
      required_success_count: newsRelayRestQuorum.required_success_count,
      daemon_token_present: Boolean(fallbackRelayDaemonToken),
      per_origin_token_count: newsRelayRestTokenMap.size,
      all_target_tokens_present: newsRelayRestWriteFirst
        ? newsRelayTokensByUrl.size === newsRelayRestWriteAuthUrls.length
        : true,
      auth_probe_results: newsRelayRestAuthResults,
    },
    failures,
  };
}

async function main() {
  const result = await runNewsAggregatorPublisherPreflight();
  const output = JSON.stringify(result);
  if (result.status === 'pass') {
    console.info(output);
    return;
  }
  console.error(output);
  process.exit(1);
}

export const newsAggregatorPublisherPreflightInternal = {
  firstNonEmpty,
  parseDelimited,
  relayHealthUrlFromPeer,
  relayRestWriteUrlFromOrigin,
  relayRequiredSuccessCount,
  truthy,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:news-daemon:preflight] failed', error);
    process.exit(1);
  });
}
