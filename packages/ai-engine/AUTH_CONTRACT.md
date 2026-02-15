# Remote Inference Auth Contract

This document defines the auth behavior for AI Engine remote inference requests.

## Required environment variable

- Remote inference requires `VITE_REMOTE_API_KEY`.
- The key is read at request time only (no in-memory caching layer).

## Security and data handling requirements

1. **Never log API keys**
   - No request path, debug, or error logging may include key material.
2. **Never include API keys in synthesis payloads**
   - Keys are only used in outbound `Authorization` headers.
   - Keys are never added to analysis/synthesis JSON payloads.
3. **Never persist API keys to mesh storage**
   - Keys are not written to `vh/*` data paths or local synthesis artifacts.

## Runtime behavior

- `validateRemoteAuth(): void` checks for `VITE_REMOTE_API_KEY` at call time.
- If missing, the engine throws a typed `RemoteAuthError`.
- `RemoteAuthError` is the canonical contract type for missing-key auth failures.

## Reference implementation

- `packages/ai-engine/src/modelConfig.ts`
  - `RemoteAuthError`
  - `validateRemoteAuth()`
  - `getRemoteApiKey()`
  - `buildRemoteRequest()` (model-aware remote request body)
