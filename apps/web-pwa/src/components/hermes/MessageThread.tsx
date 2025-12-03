import React, { useEffect, useRef } from 'react';
import type { HermesMessage } from '@vh/types';
import { MessageBubble } from './MessageBubble';

interface Props {
  channelId?: string;
  messages: Map<string, HermesMessage[]>;
  currentUser: string | null;
  statuses: Map<string, 'pending' | 'failed' | 'sent'>;
}

export const MessageThread: React.FC<Props> = ({ channelId, messages, currentUser, statuses }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const list = (channelId && messages.get(channelId)) || [];

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [list.length, channelId]);

  return (
    <div ref={containerRef} className="h-[65vh] overflow-y-auto space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      {list.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
      {list.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isMine={message.sender === currentUser}
          status={statuses.get(message.id)}
        />
      ))}
    </div>
  );
};
