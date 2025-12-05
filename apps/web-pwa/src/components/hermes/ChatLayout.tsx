import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { ChannelList } from './ChannelList';
import { MessageThread } from './MessageThread';
import { Composer } from './Composer';
import { IdentityGate } from './IdentityGate';
import { useChatStore } from '../../store/hermesMessaging';
import { useIdentity } from '../../hooks/useIdentity';

interface Props {
  activeChannelId?: string;
}

export const ChatLayout: React.FC<Props> = ({ activeChannelId }) => {
  const router = useRouter();
  const { identity } = useIdentity();
  const { channels, messages, statuses, sendMessage, getOrCreateChannel, subscribeToChannel } = useChatStore();
  const currentUser = identity?.session?.nullifier ?? null;
  const [error, setError] = useState<string | null>(null);

  const channelList = useMemo(() => Array.from(channels.values()), [channels]);
  const activeChannel =
    (activeChannelId && channels.get(activeChannelId)) || (channelList.length > 0 ? channelList[0] : null);
  const peerIdentity =
    activeChannel?.participants.find((p) => p !== currentUser) ?? activeChannel?.participants[0] ?? null;

  const handleSelect = (channelId: string) => {
    router.navigate({ to: '/hermes/messages/$channelId', params: { channelId } });
  };

  const handleSend = async (text: string) => {
    if (!peerIdentity) throw new Error('Peer identity missing');
    setError(null);
    try {
      await sendMessage(peerIdentity, { text }, 'text');
      if (activeChannel) {
        await getOrCreateChannel(peerIdentity);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message';
      console.warn('[vh:chat] failed to send', err);
      setError(message);
      throw err;
    }
  };

  useEffect(() => {
    if (!activeChannel?.id) return;
    const unsubscribe = subscribeToChannel(activeChannel.id);
    return () => {
      unsubscribe?.();
    };
  }, [activeChannel?.id, subscribeToChannel]);

  return (
    <IdentityGate>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700">
          <div className="flex items-center justify-between text-sm font-semibold text-slate-900 dark:text-slate-100">
            <span>Channels</span>
            <span className="text-xs text-slate-500">{channelList.length}</span>
          </div>
          <div className="mt-3">
            <ChannelList
              channels={channelList}
              messages={messages}
              activeChannelId={activeChannel?.id}
              onSelect={handleSelect}
            />
          </div>
        </aside>
        <section className="flex flex-col gap-3">
          <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700">
            <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {peerIdentity ? `Chat with ${peerIdentity}` : 'Select a channel'}
              </span>
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <MessageThread
              channelId={activeChannel?.id}
              messages={messages}
              currentUser={currentUser}
              statuses={statuses}
              channel={activeChannel ?? undefined}
            />
          </div>
          <Composer onSend={handleSend} disabled={!peerIdentity} />
        </section>
      </div>
    </IdentityGate>
  );
};
