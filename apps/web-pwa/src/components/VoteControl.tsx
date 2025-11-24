import React, { useEffect, useMemo, useState } from 'react';

interface VoteControlProps {
  onSubmit: (amount: number, direction: 'for' | 'against') => void;
  disabled?: boolean;
}

export const VoteControl: React.FC<VoteControlProps> = ({ onSubmit, disabled }) => {
  const [amount, setAmount] = useState(1);
  const [direction, setDirection] = useState<'for' | 'against'>('for');

  useEffect(() => {
    if (amount < 1) setAmount(1);
  }, [amount]);

  const voiceCredits = useMemo(() => amount * amount, [amount]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-700">Vote Amount (RVU)</label>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          data-testid="vote-amount"
          disabled={disabled}
        />
        <input
          type="range"
          min={1}
          max={100}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="flex-1"
          disabled={disabled}
        />
      </div>
      <div className="flex items-center gap-3 text-sm text-slate-700">
        <button
          type="button"
          className={`rounded px-3 py-1 ${direction === 'for' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-800'}`}
          onClick={() => setDirection('for')}
          data-testid="vote-for"
          disabled={disabled}
        >
          For
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1 ${direction === 'against' ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-800'}`}
          onClick={() => setDirection('against')}
          data-testid="vote-against"
          disabled={disabled}
        >
          Against
        </button>
        <span className="ml-auto text-xs text-slate-500" data-testid="voice-credits">
          Voice Credits: {voiceCredits}
        </span>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => onSubmit(amount, direction)}
          disabled={disabled}
          data-testid="submit-vote"
        >
          Submit Vote
        </button>
      </div>
    </div>
  );
};

export default VoteControl;
