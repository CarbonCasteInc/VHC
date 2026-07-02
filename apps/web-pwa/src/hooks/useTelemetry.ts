import { useSyncExternalStore } from 'react';
import {
  clearLumaTelemetry,
  emitLumaEvent,
  lumaTelemetryStore,
  redactedPathHash,
  type EmitLumaEventInput,
  type LumaEvent,
} from '@vh/luma-sdk';

export interface UseTelemetryResult {
  readonly events: readonly LumaEvent[];
  readonly emit: (event: EmitLumaEventInput) => LumaEvent;
  readonly clear: () => void;
  readonly redactedPathHash: (rawPath: string) => Promise<string>;
}

export function useTelemetry(): UseTelemetryResult {
  const events = useSyncExternalStore(
    lumaTelemetryStore.subscribe,
    lumaTelemetryStore.getSnapshot,
    lumaTelemetryStore.getSnapshot,
  );

  return {
    events,
    emit: emitLumaEvent,
    clear: () => clearLumaTelemetry({ rotateSalt: true }),
    redactedPathHash,
  };
}
