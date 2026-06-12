import React from 'react';

export const PublicBetaNotFoundState: React.FC = () => (
  <section
    data-testid="public-beta-not-found"
    className="rounded-[1.5rem] border border-slate-200/80 bg-white/86 p-5 text-slate-700 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 sm:p-6"
  >
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
      Public beta
    </p>
    <h1 className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">
      Page not found
    </h1>
    <p className="mt-2 max-w-prose text-sm leading-6 text-slate-600 dark:text-slate-300">
      That route is not part of the public news beta surface. Return to the feed and keep browsing
      from the latest published stories.
    </p>
    <div className="mt-5 flex flex-wrap gap-3">
      <a
        href="/"
        className="inline-flex items-center justify-center rounded-full border border-slate-300/80 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        Back to feed
      </a>
      <a
        href="/support"
        className="inline-flex items-center justify-center rounded-full border border-transparent bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
      >
        Support
      </a>
    </div>
  </section>
);

export default PublicBetaNotFoundState;
