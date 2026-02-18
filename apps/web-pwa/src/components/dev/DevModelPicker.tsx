import React, { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'vh_dev_model_override';
export const DEV_MODEL_CHANGED_EVENT = 'vh:dev-model-changed';

function emitModelChangedEvent(model: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(DEV_MODEL_CHANGED_EVENT, {
      detail: { model },
    }),
  );
}

const MODEL_OPTIONS = [
  { value: '', label: 'Auto / Default' },
  { value: 'openai-codex/gpt-5.2-codex', label: 'gpt-5.2' },
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  { value: 'claude-3-haiku', label: 'claude-3-haiku' },
  { value: 'claude-3-sonnet', label: 'claude-3-sonnet' },
] as const;

export function getDevModelOverride(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const stored = localStorage.getItem(LS_KEY);
    return stored?.trim() || null;
  } catch {
    return null;
  }
}

function readStoredModel(): string {
  try {
    return localStorage.getItem(LS_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export const DevModelPicker: React.FC = () => {
  if (!import.meta.env.DEV) return null;

  const [expanded, setExpanded] = useState(false);
  const [model, setModel] = useState(readStoredModel);

  useEffect(() => {
    setModel(readStoredModel());
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setModel(value);
    try {
      if (value) {
        localStorage.setItem(LS_KEY, value);
      } else {
        localStorage.removeItem(LS_KEY);
      }
    } catch {
      /* storage unavailable */
    }

    emitModelChangedEvent(value || null);
  }, []);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const selectedOption = MODEL_OPTIONS.find((option) => option.value === model);
  const displayLabel = model ? (selectedOption?.label ?? model) : 'default';

  return (
    <div
      data-testid="dev-model-picker"
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
      }}
    >
      <button
        type="button"
        onClick={toggle}
        data-testid="dev-model-picker-toggle"
        style={{
          background: '#7c3aed',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          padding: '4px 10px',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        🧪 {displayLabel}
      </button>

      {expanded && (
        <div
          data-testid="dev-model-picker-panel"
          style={{
            position: 'absolute',
            bottom: 32,
            right: 0,
            background: '#fff',
            border: '1px solid #d4d4d8',
            borderRadius: 8,
            padding: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            minWidth: 180,
          }}
        >
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Dev Model Override
          </label>
          <select
            data-testid="dev-model-picker-select"
            value={model}
            onChange={handleChange}
            style={{ width: '100%', fontSize: 12, padding: '2px 4px' }}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default DevModelPicker;
