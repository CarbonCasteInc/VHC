const statusEl = document.querySelector('#status');
const tokenInput = document.querySelector('#deviceToken');
const enrollmentInput = document.querySelector('#enrollmentSecret');

function show(value) {
  statusEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function base64UrlToUint8Array(value) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`;
  const base64 = padded.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function ensureWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('service_worker_unavailable');
  return await navigator.serviceWorker.register('/service-worker.js');
}

document.querySelector('#enable').addEventListener('click', async () => {
  try {
    const registration = await ensureWorker();
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error(`notification_permission_${permission}`);
    const configResponse = await fetch('/api/config');
    const config = await configResponse.json();
    if (!config.vapidPublicKey) throw new Error('vapid_public_key_missing');
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
    });
    const response = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vhc-enrollment-secret': enrollmentInput.value,
      },
      body: JSON.stringify(subscription),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.reason ?? `subscribe_http_${response.status}`);
    show({ status: 'notifications_enabled', subscriptionId: body.id });
  } catch (error) {
    show({ status: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
});

document.querySelector('#health').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/health', {
      headers: tokenInput.value ? { authorization: `Bearer ${tokenInput.value}` } : {},
    });
    show(await response.json());
  } catch (error) {
    show({ status: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
});
