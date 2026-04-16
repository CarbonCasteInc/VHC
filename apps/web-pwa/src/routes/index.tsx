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
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 lg:px-8">
        <header className="sticky top-4 z-40 mb-8">
          <div className="rounded-[2rem] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_24px_60px_-38px_rgba(15,23,42,0.4)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/70">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500 dark:text-slate-400">
                    VHC
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      News, context, and conversation in one feed
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Peers {peersCount}
                    </span>
                  </div>
                </div>

                <nav className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    to="/"
                    className="rounded-full border border-slate-200 px-4 py-2 font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white [&.active]:border-slate-900 [&.active]:bg-slate-900 [&.active]:text-white dark:[&.active]:border-white dark:[&.active]:bg-white dark:[&.active]:text-slate-900"
                  >
                    VENN
                  </Link>
                  <Link
                    to="/hermes"
                    className="rounded-full border border-slate-200 px-4 py-2 font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white [&.active]:border-slate-900 [&.active]:bg-slate-900 [&.active]:text-white dark:[&.active]:border-white dark:[&.active]:bg-white dark:[&.active]:text-slate-900"
                  >
                    HERMES
                  </Link>
                  <Link
                    to="/governance"
                    className="rounded-full border border-slate-200 px-4 py-2 font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white [&.active]:border-slate-900 [&.active]:bg-slate-900 [&.active]:text-white dark:[&.active]:border-white dark:[&.active]:bg-white dark:[&.active]:text-slate-900"
                  >
                    AGORA
                  </Link>
                </nav>
              </div>

              <div className="flex items-center justify-end gap-2 text-sm text-slate-500 dark:text-slate-300">
                <ThemeToggle />
                <Link
                  to="/hermes/messages"
                  aria-label="Messages"
                  className="inline-flex items-center justify-center rounded-full border border-slate-300/80 bg-white/80 p-2 text-slate-600 transition hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
                  data-testid="nav-messages"
                >
                  <span aria-hidden="true">💬</span>
                </Link>
                <Link
                  to="/dashboard"
                  aria-label="User"
                  data-testid="user-link"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/80 px-3 py-2 text-slate-600 transition hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em]">User</span>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="space-y-6">
          {initializing && !client ? (
            <div className="rounded-lg border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-700">
              <p className="text-sm text-slate-700 dark:text-slate-200">Loading Mesh…</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
      {import.meta.env.DEV && <DevColorPanel />}
    </PageWrapper>
  );
};

const HomeComponent = () => <FeedList />;

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
  const search = location.search as {
    sourceSynthesisId?: string;
    sourceEpoch?: number;
    sourceAnalysisId?: string;
    title?: string;
    sourceUrl?: string;
  };
  const sourceSynthesisId = search?.sourceSynthesisId ?? search?.sourceAnalysisId;
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
        <ForumFeed
          sourceSynthesisId={sourceSynthesisId}
          sourceEpoch={search?.sourceEpoch}
          defaultTitle={search?.title}
          sourceUrl={search?.sourceUrl}
        />
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

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeComponent,
  validateSearch: (search: Record<string, unknown>) => search,
});
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
