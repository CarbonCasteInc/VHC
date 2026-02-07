# CSP Header Migration Guide

This guide documents TRINITY’s current Content Security Policy (CSP) posture, known limitations of meta-tag delivery, and a phased migration path to HTTP header-based CSP when deployment infrastructure supports custom headers. Related work: Issue #47 (follow-up) and PR #45 (initial CSP implementation).

## 1. Current Posture

- **Delivery mechanism:** `<meta http-equiv="Content-Security-Policy">` in `apps/web-pwa/index.html`
- **Current policy source:** static HTML entrypoint (no server/CDN header injection available today)

### Active directives (current meta tag)

| Directive | Value | Purpose |
|---|---|---|
| `default-src` | `'self'` | Fallback for all fetch directives |
| `script-src` | `'self'` | Only first-party scripts |
| `style-src` | `'self' 'unsafe-inline'` | First-party styles + inline styles required by current CSS-in-JS / Tailwind runtime |
| `connect-src` | `'self'` | Restrict fetch/XHR/WebSocket origins |
| `img-src` | `'self' data: blob:` | Allow self-hosted images, data URIs, and blob URLs |
| `worker-src` | `'self' blob:` | Restrict worker/service-worker script origins |
| `object-src` | `'none'` | Block plugin/object embedding |
| `base-uri` | `'self'` | Prevent base-tag hijacking |
| `form-action` | `'self'` | Restrict form submission targets |

**Notable absences (meta-tag limitation):** `frame-ancestors`, `report-uri`, `report-to`, and `sandbox` are not available via `<meta>` CSP delivery (details in §2).

## 2. Meta-Tag Limitations

Per **W3C CSP Level 3 §4.1** (`<meta>` delivery restrictions), CSP delivered through an HTML meta element cannot include:

- `frame-ancestors` (no clickjacking protection via meta-delivered CSP)
- `report-uri` (deprecated) / `report-to` (no violation-reporting endpoint wiring via meta delivery)
- `sandbox`

Source: https://www.w3.org/TR/CSP3/#meta-element

Additional operational limitation:

- `Content-Security-Policy-Report-Only` is an **HTTP response header only**. It cannot be delivered via `<meta>`, so staged observe-first rollout is not possible until header control exists.

MDN reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy#csp_in_meta_elements

Nonce/hash note:

- Meta-delivered CSP can still use nonce/hash sources for `script-src`/`style-src`, but nonce generation must happen at build/render time (no per-request server nonce if you do not control HTTP response generation). Current policy uses `'self'` for scripts and does not depend on nonce/hash yet.

## 3. Decision Log: Why Meta-Tag Was Chosen

- **Context:** TRINITY is currently deployed as a static PWA with no server runtime that can inject response headers.
- **Constraint:** No server/CDN header control at deploy boundary.
- **Decision:** Use `<meta http-equiv="Content-Security-Policy">` now to enforce the strongest practical baseline under static-hosting constraints.
- **Accepted trade-off:** Lack of `frame-ancestors`, `report-uri`/`report-to`, `sandbox`, and Report-Only rollout mode until HTTP-header delivery is available.
- **Decision date:** 2026-02-07 (PR #45 / Issue #44).

## 4. Migration Playbook: Meta → HTTP Header

### Prerequisites checklist

- [ ] Deployment supports custom HTTP headers (e.g., Nginx `add_header`, Cloudflare rules, Vercel `headers`, Netlify `_headers`).
- [ ] `Content-Security-Policy-Report-Only` can be deployed independently of enforced CSP.
- [ ] A CSP violation report collector/endpoint is available.

### Phase 1 — Report-Only (observe)

1. Deploy `Content-Security-Policy-Report-Only` as an HTTP header with the same directives as the current meta policy, plus reporting and framing controls.
2. Keep the existing `<meta http-equiv="Content-Security-Policy">` in `index.html` during the observation window.
3. Monitor violations for 7–14 days and classify expected vs. unexpected behavior.
4. Resolve legitimate violations before enforcement.

> Note (W3C behavior): if both meta CSP and header CSP are present, browsers enforce both policies as an intersection. Keep Phase 1 directives aligned to avoid accidental breakage.

### Phase 2 — Enforce via HTTP header

1. Move CSP enforcement to the `Content-Security-Policy` response header.
2. Include `frame-ancestors 'self'`.
3. Include reporting directives (`report-to`, with `report-uri` fallback for compatibility).
4. Update `connect-src` to include required Gun relay peer origins before removing meta CSP (example: `connect-src 'self' wss://relay.example.com`).
5. Remove `<meta http-equiv="Content-Security-Policy">` from `index.html` only after validation passes.

### Phase 3 — Tighten (optional)

1. Remove `'unsafe-inline'` from `style-src` once style hashing/nonces are supported by build/runtime.
2. Add `sandbox` where deployment context permits.
3. Add `upgrade-insecure-requests` for strict HTTPS posture.
4. Consider `require-trusted-types-for 'script'` as a DOM XSS hardening layer.

### Target header example (Phase 2)

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' wss://relay.example.com;
  img-src 'self' data: blob:;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'self';
  report-to default;
  report-uri https://csp-report.example.com/collect
```

### Verification checklist (post-migration)

- [ ] `frame-ancestors 'self'` blocks cross-origin framing attempts.
- [ ] CSP reports arrive at configured reporting endpoint(s).
- [ ] No `<meta http-equiv="Content-Security-Policy">` remains in `apps/web-pwa/index.html`.
- [ ] Core app flows still work (messaging, forum, governance, analysis, share).
- [ ] Service worker registration succeeds.
- [ ] Gun WebSocket peers connect successfully under updated `connect-src`.

## 5. Permissions-Policy Header (Future)

`Permissions-Policy` (formerly Feature-Policy) should be introduced with the CSP-header migration once HTTP header control is available.

Recommended initial policy:

```http
Permissions-Policy:
  camera=(),
  microphone=(),
  geolocation=(),
  payment=(),
  usb=(),
  magnetometer=(),
  gyroscope=(),
  accelerometer=()
```

Rationale:

- TRINITY does not currently require these APIs for baseline operation.
- Denying unused privileged APIs reduces abuse surface if another control fails.

Future adjustment guidance:

- If LUMA introduces camera-based liveness, move to `camera=(self)`.
- If civic workflows require location features, move to `geolocation=(self)`.

## 6. Browser Compatibility Notes

- **Meta-tag CSP**: supported in modern browsers (Chrome 46+, Firefox 45+, Safari 10+, Edge 14+).
- **`report-to`** (HTTP header only): Chrome 70+, Edge 79+; Firefox relies on `report-uri` fallback; Safari support is partial.
- **Recommendation**: during migration, emit both `report-to` (modern) and `report-uri` (fallback) for wider coverage.
- **Permissions-Policy**: Chrome 88+, Edge 88+, Firefox 74+ (historically under Feature-Policy semantics), Safari partial.

## 7. References

- W3C CSP Level 3: https://www.w3.org/TR/CSP3/
- W3C CSP Level 3 §4.1 (meta element): https://www.w3.org/TR/CSP3/#meta-element
- MDN CSP (`<meta>` limitations): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy#csp_in_meta_elements
- MDN Permissions-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy
- PR #45 (Issue #44): initial CSP meta-tag implementation
- Issue #47: CSP header hardening & documentation follow-up
- `docs/specs/secure-storage-policy.md`
- `docs/foundational/ARCHITECTURE_LOCK.md`
