import { Link, createRootRoute, createRoute, Outlet, useRouterState, useParams } from '@tanstack/react-router';
import React, { Suspense, useEffect, useMemo } from 'react';
import { Button } from '@vh/ui';
import { useAppStore } from '../store';
import FeedList from '../components/FeedList';
import ProposalList from '../components/ProposalList';
import { PageWrapper } from '../components/PageWrapper';
import ThemeToggle from '../components/ThemeToggle';
import { ChatLayout } from '../components/hermes/ChatLayout';
import { ForumFeed } from '../components/hermes/forum/ForumFeed';
import { ThreadView } from '../components/hermes/forum/ThreadView';
import { IDChip } from '../components/hermes/IDChip';
import { ScanContact } from '../components/hermes/ScanContact';
import { DashboardPage } from './dashboardContent';
import { DevColorPanel } from '../components/DevColorPanel';
import { InviteGate } from '../components/InviteGate';

const RootComponent = () => (
  <RootShell>
    <Outlet />
  </RootShell>
);

const RootShell = ({ children }: { children: React.ReactNode }) => {
  const { client, initializing, init } = useAppStore();
  const { location } = useRouterState();

  useEffect(() => {
    void init();
  }, [init]);

  const variant: 'venn' | 'hermes' | 'agora' = (() => {
    if (location.pathname.startsWith('/hermes')) return 'hermes';
    if (location.pathname.startsWith('/governance')) return 'agora';
    return 'venn';
  })();

  const peersCount = client?.config.peers.length ?? 0;

  return (
    <PageWrapper variant={variant}>
      <div className="mx-auto max-w-4xl px-6 py-6 space-y-8">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-slate-200 pb-3 dark:border-slate-800">
          <div className="text-left">
            <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">Peers: {peersCount}</p>
          </div>
          <nav className="flex items-center gap-4 text-[44px] font-light tracking-[0.2em] leading-[1.05] text-slate-900 dark:text-slate-50 uppercase">
            <Link to="/" className="hover:text-teal-700 dark:hover:text-emerald-300 [&.active]:text-teal-700 dark:[&.active]:text-emerald-300">VENN</Link>
            <span className="text-slate-400 dark:text-slate-600">/</span>
            <Link to="/hermes" className="hover:text-teal-700 dark:hover:text-emerald-300 [&.active]:text-teal-700 dark:[&.active]:text-emerald-300">HERMES</Link>
            <span className="text-slate-400 dark:text-slate-600">/</span>
            <Link to="/governance" className="hover:text-teal-700 dark:hover:text-emerald-300 [&.active]:text-teal-700 dark:[&.active]:text-emerald-300">AGORA</Link>
          </nav>
          <div className="flex items-center justify-end gap-2 text-sm text-slate-500 dark:text-slate-300">
            <ThemeToggle />
            <Link
              to="/hermes/messages"
              aria-label="Messages"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              data-testid="nav-messages"
            >
              <span aria-hidden="true">💬</span>
            </Link>
            <Link
              to="/dashboard"
              aria-label="User"
              data-testid="user-link"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs font-semibold">User</span>
            </Link>
          </div>
        </header>
        <main className="space-y-6">
          {initializing && !client ? (
            <div className="rounded-lg border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-700">
              <p className="text-sm text-slate-700 dark:text-slate-200">Loading Mesh…</p>
            </div>
          ) : (
            <InviteGate>{children}</InviteGate>
          )}
        </main>
      </div>
      {import.meta.env.DEV && <DevColorPanel />}
    </PageWrapper>
  );
};

const HomeComponent = () => (
  <section className="space-y-4">
    <div
      className="rounded-2xl p-5 shadow-sm space-y-3"
      style={{
        backgroundColor: 'var(--section-container-bg)',
        borderColor: 'var(--section-container-border)',
        borderWidth: '1px',
        borderStyle: 'solid'
      }}
    >
      <p
        className="text-sm font-semibold tracking-[0.08em] uppercase"
        style={{ color: 'var(--section-title)' }}
      >
        Headlines
      </p>
      <FeedList />
    </div>
  </section>
);

const DashboardComponent = DashboardPage;

const GovernanceComponent = () => (
  <section className="space-y-4">
    <div className="rounded-2xl border border-slate-200/80 bg-card p-5 shadow-sm shadow-slate-900/5 dark:border-slate-700">
      <h2 className="text-xl font-semibold tracking-[0.04em] text-slate-900">Governance</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">Season 0: local-only voting with per-user status.</p>
    </div>
    <Suspense fallback={<div className="rounded-2xl border border-slate-200/80 bg-card p-5 text-sm text-slate-700 shadow-sm shadow-slate-900/5 dark:border-slate-700">Loading proposals…</div>}>
      <ProposalList />
    </Suspense>
  </section>
);

const HermesShell: React.FC = () => {
  return (
    <section className="space-y-4">
      <Outlet />
    </section>
  );
};

// /hermes shows the forum feed directly
const HermesIndexPage: React.FC = () => {
  const { location } = useRouterState();
  const search = location.search as { sourceAnalysisId?: string; title?: string; sourceUrl?: string };
  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl p-5 shadow-sm space-y-3"
        style={{
          backgroundColor: 'var(--section-container-bg)',
          borderColor: 'var(--section-container-border)',
          borderWidth: '1px',
          borderStyle: 'solid'
        }}
      >
        <p
          className="text-sm font-semibold tracking-[0.08em] uppercase"
          style={{ color: 'var(--section-title)' }}
        >
          Forum Threads
        </p>
        <ForumFeed sourceAnalysisId={search?.sourceAnalysisId} defaultTitle={search?.title} sourceUrl={search?.sourceUrl} />
      </div>
    </div>
  );
};

const HermesMessagesPage: React.FC = () => {
  const params = useParams({ strict: false });
  const channelId = (params as { channelId?: string }).channelId;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <ChatLayout activeChannelId={channelId} />
        <div className="space-y-3">
          <IDChip />
          <ScanContact />
        </div>
      </div>
    </div>
  );
};

const HermesThreadPage: React.FC = () => {
  const { threadId } = useParams({ from: '/hermes/$threadId' });
  return (
    <div className="space-y-4">
      <ThreadView threadId={threadId} />
    </div>
  );
};

const rootRoute = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <div className="text-slate-700">Not Found</div>
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeComponent });
const hermesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/hermes', component: HermesShell });
const hermesIndexRoute = createRoute({
  getParentRoute: () => hermesRoute,
  path: '/',
  component: HermesIndexPage
});
const hermesMessagesRoute = createRoute({
  getParentRoute: () => hermesRoute,
  path: '/messages',
  component: HermesMessagesPage
});
const hermesMessagesChannelRoute = createRoute({
  getParentRoute: () => hermesRoute,
  path: '/messages/$channelId',
  component: HermesMessagesPage
});
const hermesThreadRoute = createRoute({
  getParentRoute: () => hermesRoute,
  path: '/$threadId',
  component: HermesThreadPage
});
const governanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/governance',
  component: GovernanceComponent
});
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardComponent
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  hermesRoute.addChildren([hermesIndexRoute, hermesMessagesRoute, hermesMessagesChannelRoute, hermesThreadRoute]),
  governanceRoute,
  dashboardRoute
]);
