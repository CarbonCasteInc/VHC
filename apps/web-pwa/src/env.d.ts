/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E_MODE?: 'true' | 'false';
  readonly VITE_GUN_PEERS?: string;
  readonly VITE_ATTESTATION_URL?: string;
  readonly VITE_ATTESTATION_TIMEOUT_MS?: string;
  readonly VITE_REMOTE_ENGINE_URL?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_UBE_ADDRESS?: string;
  readonly VITE_RVU_ADDRESS?: string;
  readonly VITE_ELEVATION_ENABLED?: 'true' | 'false';
  readonly VITE_LINKED_SOCIAL_ENABLED?: 'true' | 'false';
  readonly VITE_HERMES_DOCS_ENABLED?: 'true' | 'false';
  readonly VITE_DOCS_COLLAB_ENABLED?: 'true' | 'false';
  readonly VITE_SESSION_LIFECYCLE_ENABLED?: 'true' | 'false';
  readonly VITE_CONSTITUENCY_PROOF_REAL?: 'true' | 'false';
  readonly VITE_REMOTE_ENGINE_API_KEY?: string;
  readonly VITE_IDB_ROOT_SECRET?: string;
  readonly VITE_IDB_ROOT_SALT?: string;
  readonly VITE_INVITE_ONLY_ENABLED?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
