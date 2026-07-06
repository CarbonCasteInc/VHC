const encoder = new TextEncoder();

function cryptoApi() {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  throw new Error('WebCrypto subtle API is required');
}

function base64UrlBytes(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlText(text) {
  return base64UrlBytes(encoder.encode(text));
}

function endpointAudience(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}

export function safeNotificationPayload({ incidentKey, severity, alertClass, issueUrl }) {
  const safeSeverity = severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
  const safeClass = String(alertClass ?? 'unknown').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 80);
  return {
    title: `[VHC A6] ${safeSeverity}: ${safeClass}`,
    body: 'Open the VHC pager for the public-safe incident case file.',
    data: {
      incidentKey: String(incidentKey ?? ''),
      issueUrl: issueUrl && /^https:\/\/github\.com\/CarbonCasteInc\/VHC\/issues\/\d+$/.test(issueUrl)
        ? issueUrl
        : null,
    },
  };
}

export async function vapidJwt({ endpoint, subject, publicKey, privateJwk, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: endpointAudience(endpoint),
    exp: nowSeconds + 12 * 60 * 60,
    sub: subject,
  };
  const signingInput = `${base64UrlText(JSON.stringify(header))}.${base64UrlText(JSON.stringify(payload))}`;
  const key = await cryptoApi().subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoApi().subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  );
  return {
    jwt: `${signingInput}.${base64UrlBytes(signature)}`,
    publicKey,
  };
}

export async function sendPushWakeup({
  subscription,
  vapid,
  fetchImpl = fetch,
}) {
  const { jwt, publicKey } = await vapidJwt({
    endpoint: subscription.endpoint,
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateJwk: vapid.privateJwk,
    nowSeconds: vapid.nowSeconds,
  });
  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      ttl: String(vapid.ttlSeconds ?? 300),
      authorization: `vapid t=${jwt}, k=${publicKey}`,
      'crypto-key': `p256ecdsa=${publicKey}`,
    },
  });
  if (response.status === 404 || response.status === 410) {
    return { status: 'dead_subscription', httpStatus: response.status };
  }
  if (!response.ok) return { status: 'failed', httpStatus: response.status };
  return { status: 'sent', httpStatus: response.status };
}

export async function dispatchPushWakeups({
  subscriptions,
  vapid,
  store,
  fetchImpl = fetch,
}) {
  const results = [];
  for (const subscription of subscriptions) {
    const result = await sendPushWakeup({ subscription, vapid, fetchImpl });
    results.push({ id: subscription.id, ...result });
    if (result.status === 'dead_subscription' && store?.markSubscriptionDead) {
      await store.markSubscriptionDead(subscription.id);
    }
  }
  const activeCount = store?.activeSubscriptionCount ? await store.activeSubscriptionCount() : null;
  return {
    results,
    activeCount,
    zeroActiveSubscriptions: activeCount === 0,
  };
}
