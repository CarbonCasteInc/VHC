import React, { useState } from 'react';
import { Button } from '@vh/ui';

interface Props {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}

export const Composer: React.FC<Props> = ({ onSend, disabled }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(trimmed);
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-card p-2 dark:border-slate-700">
      <textarea
        className="h-12 w-full resize-none rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
        placeholder="Type a message…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled || busy}
      />
      <Button size="sm" disabled={!text.trim() || disabled || busy} onClick={() => void handleSend()}>
        {busy ? 'Sending…' : 'Send'}
      </Button>
    </div>
  );
};
