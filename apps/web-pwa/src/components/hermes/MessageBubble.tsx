import React from 'react';
import type { HermesMessage } from '@vh/types';

interface Props {
  message: HermesMessage;
  isMine: boolean;
  status?: 'pending' | 'failed' | 'sent';
}

export const MessageBubble: React.FC<Props> = ({ message, isMine, status }) => {
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} text-sm`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
          isMine ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
        }`}
      >
        <p className="break-words">{message.content}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-200">
          <span className="text-[10px] opacity-80">{new Date(message.timestamp).toLocaleTimeString()}</span>
          {status && (
            <span
              className={`rounded-full px-2 py-[2px] ${
                status === 'failed'
                  ? 'bg-red-500 text-white'
                  : status === 'pending'
                    ? 'bg-amber-400 text-slate-900'
                    : 'bg-emerald-400 text-slate-900'
              }`}
            >
              {status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
