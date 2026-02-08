import { useCallback, useState } from 'react';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

export const REMOTE_ENGINE_OPT_IN_STORAGE_KEY = 'vh_remote_engine_opt_in_v1';

function readOptInValue(): boolean {
  return safeGetItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY) === 'true';
}

function writeOptInValue(value: boolean): void {
  safeSetItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY, value ? 'true' : 'false');
}

export function useRemoteEngineOptIn() {
  const [optedIn, setOptedInState] = useState<boolean>(() => readOptInValue());

  const setOptIn = useCallback((value: boolean) => {
    setOptedInState(value);
    writeOptInValue(value);
  }, []);

  return {
    optedIn,
    setOptIn
  };
}
