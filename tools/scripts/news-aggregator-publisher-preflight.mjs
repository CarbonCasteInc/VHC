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

function assertPresent(env, name, failures) {
  if (!firstNonEmpty(env[name])) {
    failures.push(`${name}:missing`);
    return false;
  }
  return true;
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

  const synthesisEnabled = truthy(env.VH_BUNDLE_SYNTHESIS_ENABLED)
    || Boolean(firstNonEmpty(env.VH_BUNDLE_SYNTHESIS_API_KEY, env.ANALYSIS_RELAY_API_KEY, env.OPENAI_API_KEY));
  const relayRestOrigins = parseDelimited(env.VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS);
  const relayRestWriteRequested = truthy(env.VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST)
    || relayRestOrigins.length > 0;
  if (synthesisEnabled) {
    if (!relayRestWriteRequested) failures.push('relay_rest_synthesis:disabled_while_synthesis_enabled');
    if (relayRestOrigins.length === 0) failures.push('relay_rest_synthesis_origins:missing');
    if (!firstNonEmpty(env.VH_RELAY_DAEMON_TOKEN)) failures.push('relay_rest_synthesis_token:missing');
    for (const origin of relayRestOrigins) {
      const url = validUrl(origin, 'relay_rest_synthesis_origin', failures);
      if (url && !['http:', 'https:'].includes(url.protocol)) {
        failures.push('relay_rest_synthesis_origin:unsupported_protocol');
      }
    }
  }

  const relayResults = [];
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
    synthesis_enabled: synthesisEnabled,
    relay_rest_synthesis: {
      requested: relayRestWriteRequested,
      origin_count: relayRestOrigins.length,
      daemon_token_present: Boolean(firstNonEmpty(env.VH_RELAY_DAEMON_TOKEN)),
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
  truthy,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:news-daemon:preflight] failed', error);
    process.exit(1);
  });
}
