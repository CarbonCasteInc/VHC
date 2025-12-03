import React from 'react';
import type { HermesComment } from '@vh/types';

interface Props {
  base: HermesComment;
  counterpoints: HermesComment[];
}

export const CounterpointPanel: React.FC<Props> = ({ base, counterpoints }) => {
  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700 md:grid-cols-2">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Argument</p>
        <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">{base.content}</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-amber-600">Counterpoints</p>
        {counterpoints.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        {counterpoints.map((c) => (
          <div key={c.id} className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-500/50 dark:bg-amber-900/30">
            {c.content}
          </div>
        ))}
      </div>
    </div>
  );
};
