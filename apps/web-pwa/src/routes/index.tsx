import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import React from 'react';
import { Button } from '@vh/ui';
import { createClient } from '@vh/gun-client';

const vennClient = createClient({ peers: ['http://localhost:7777/gun'] });

const RootComponent = () => (
  <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900">
    <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">TRINITY · VENN/HERMES</p>
          <h1 className="text-3xl font-semibold text-slate-900">Hello Trinity</h1>
          <p className="text-slate-600">Local-first nervous system online.</p>
        </div>
        <div className="text-right text-sm text-slate-500">
          <p>Peers: {vennClient.config.peers.length}</p>
        </div>
      </header>
      <main className="space-y-6">
        <Outlet />
      </main>
    </div>
  </div>
);

const HomeComponent = () => (
  <section className="space-y-4">
    <p className="text-lg text-slate-700">Your Guardian Node stack is live. Next: hydrate the graph and start composing signals.</p>
    <div className="flex gap-3">
      <Button onClick={() => console.log('bootstrap mesh')}>Bootstrap Mesh</Button>
      <Button variant="secondary" onClick={() => console.log('open settings')}>
        Open Settings
      </Button>
    </div>
  </section>
);

const rootRoute = createRootRoute({ component: RootComponent });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeComponent });

export const routeTree = rootRoute.addChildren([indexRoute]);
