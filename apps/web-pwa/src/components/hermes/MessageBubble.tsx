import React, { useEffect, useState } from 'react';
import type { HermesMessage } from '@vh/types';
import { decryptMessagePayload, deriveSharedSecret } from '@vh/gun-client';
import { useIdentity } from '../../hooks/useIdentity';

interface Props {
  message: HermesMessage;
  isMine: boolean;
  status?: 'pending' | 'failed' | 'sent';
}

export const MessageBubble: React.FC<Props> = ({ message, isMine, status }) => {
  const { identity } = useIdentity();
  const [plaintext, setPlaintext] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const devicePair = identity?.devicePair;
        if (!devicePair?.epub || !devicePair?.epriv) {
          setPlaintext('[No device key]');
          return;
        }
        const senderPub = message.senderDevicePub;
        if (!senderPub) {
          setPlaintext('[Missing sender key]');
          return;
        }
        const secret = await deriveSharedSecret(senderPub, { epub: devicePair.epub, epriv: devicePair.epriv });
        const payload = await decryptMessagePayload(message.content, secret);
        if (!cancelled) {
          setPlaintext(payload.text ?? '[empty]');
        }
      } catch {
        if (!cancelled) setPlaintext('[Unable to decrypt]');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [message, identity]);

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} text-sm`} data-testid={`message-${message.id}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
          isMine ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
        }`}
      >
        <p className="break-words">{plaintext ?? message.content}</p>
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
