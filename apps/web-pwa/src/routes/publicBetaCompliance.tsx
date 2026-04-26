import { Link } from '@tanstack/react-router';
import React from 'react';

export type PublicBetaCompliancePageId =
  | 'beta'
  | 'privacy'
  | 'terms'
  | 'moderation'
  | 'support'
  | 'data-deletion'
  | 'telemetry'
  | 'copyright';

interface PublicBetaComplianceSection {
  readonly heading: string;
  readonly body: readonly string[];
}

export interface PublicBetaCompliancePage {
  readonly id: PublicBetaCompliancePageId;
  readonly route: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly PublicBetaComplianceSection[];
}

export const PUBLIC_BETA_COMPLIANCE_PAGES: readonly PublicBetaCompliancePage[] = [
  {
    id: 'beta',
    route: '/beta',
    eyebrow: 'Public Beta Scope',
    title: 'VHC Public Beta Scope',
    summary:
      'VHC Web PWA beta is a limited news, analysis, stance, and discussion preview. It is not a native app release, legal advice, civic advice, emergency service, verified-human system, or complete trust-and-safety program.',
    sections: [
      {
        heading: 'What is in scope',
        body: [
          'The beta covers the Web PWA news feed, curated fallback launch content, accepted synthesis story detail, frame/reframe stance controls, story-thread replies, report intake, synthesis correction, and audited comment hide/restore actions.',
          'Beta-local identity and proof surfaces are labeled as beta-local. They must not be presented as district verification, Sybil resistance, residency proof, or one-human-one-vote assurance.',
        ],
      },
      {
        heading: 'What is not in scope',
        body: [
          'No App Store, TestFlight, native shell, production legal signoff, user blocking system, appeal workflow, notification/escalation workflow, or full trust-and-safety console is included in this beta minimum.',
          'Live news ingestion may be stale or unavailable. The validated snapshot exists for deterministic QA and demos; it does not prove live source freshness.',
        ],
      },
    ],
  },
  {
    id: 'privacy',
    route: '/privacy',
    eyebrow: 'Privacy',
    title: 'Privacy Notice',
    summary:
      'The beta keeps sensitive stance events local where possible and publishes only the public news, discussion, report, correction, moderation, and aggregate records needed for the MVP loop.',
    sections: [
      {
        heading: 'Public records',
        body: [
          'Story threads, story replies, report records, correction records, moderation records, and aggregate civic metadata are public workflow or audit surfaces. They can include public pseudonymous reporter and operator identifiers.',
          'Do not submit private contact details, identity documents, raw proof material, provider secrets, or support correspondence into story replies or report reasons.',
        ],
      },
      {
        heading: 'Local and sensitive data',
        body: [
          'Vote intent records, local identity state, local proof state, and sensitive per-user signals are treated as local or sensitive surfaces rather than public mesh content.',
          'Public aggregate payloads must not include nullifiers, wallet addresses, district proof payloads, access tokens, or raw per-user event records.',
        ],
      },
    ],
  },
  {
    id: 'terms',
    route: '/terms',
    eyebrow: 'Terms',
    title: 'Beta Terms',
    summary:
      'Use of the beta is limited to evaluation of the Web PWA MVP. Content is informational, machine-assisted, and may be incomplete or wrong.',
    sections: [
      {
        heading: 'Use boundaries',
        body: [
          'Do not rely on VHC for legal, medical, financial, election, emergency, or safety-critical decisions.',
          'Do not submit unlawful, abusive, harassing, private, confidential, infringing, or intentionally misleading content.',
        ],
      },
      {
        heading: 'Service limits',
        body: [
          'The beta may change, lose local state, show stale launch snapshot content, or become unavailable without notice.',
          'Operators may dismiss reports, suppress or mark synthesis unavailable, and hide or restore story-thread comments using the audited remediation paths implemented in the Web PWA.',
        ],
      },
    ],
  },
  {
    id: 'moderation',
    route: '/moderation',
    eyebrow: 'UGC and Moderation',
    title: 'UGC and Moderation Policy',
    summary:
      'Story-thread replies and report reasons are user-generated content. The current beta supports report intake and audited operator actions, not a full moderation operations program.',
    sections: [
      {
        heading: 'User-generated content rules',
        body: [
          'Do not post threats, targeted harassment, hate, spam, private personal data, explicit illegal instructions, malware, impersonation, copyright-infringing material, or content whose main purpose is to disrupt the beta.',
          'Report inaccurate synthesis artifacts, abusive story-thread comments, spam, policy issues, and source attribution errors through the in-product report controls.',
        ],
      },
      {
        heading: 'Operator actions',
        body: [
          'Operators can dismiss reports, suppress accepted synthesis, mark synthesis unavailable, hide story-thread comments, and restore story-thread comments with audit metadata.',
          'User blocking, trust-gated operator roles, notifications, appeals, escalation workflow, and broader case management remain outside this minimum beta surface.',
        ],
      },
    ],
  },
  {
    id: 'support',
    route: '/support',
    eyebrow: 'Support',
    title: 'Beta Support and Contact',
    summary:
      'Public beta participation requires a reachable beta operator contact channel. The app does not collect private support correspondence in public report records.',
    sections: [
      {
        heading: 'How to get help',
        body: [
          'Use the support or escalation channel supplied with your beta invitation for account, access, safety, deletion, copyright, or urgent operational questions.',
          'If you do not have a beta operator contact channel, do not submit personal support information into the app; wait for an operator-provided contact path before using the public beta.',
        ],
      },
      {
        heading: 'What reports are for',
        body: [
          'In-product reports are for news synthesis and story-thread content review. They are public workflow records and are not a private support inbox.',
          'Do not include private contact details, legal notices, identity documents, or sensitive personal facts in report reason text.',
        ],
      },
    ],
  },
  {
    id: 'data-deletion',
    route: '/data-deletion',
    eyebrow: 'Data Deletion',
    title: 'Data Deletion and Local State',
    summary:
      'The beta separates local browser state from public mesh audit records. Local data can be cleared locally; public records require operator review and may remain as audit artifacts.',
    sections: [
      {
        heading: 'Local browser data',
        body: [
          'You can clear local browser storage to remove local cached state, local identity state, preferences, and local-only vote intent queues from that browser.',
          'Clearing local data does not remove public story replies, public reports, correction records, moderation records, or aggregate records already written to the mesh.',
        ],
      },
      {
        heading: 'Public records',
        body: [
          'Ask the beta operator contact channel for deletion or correction review of public records tied to your pseudonymous beta activity.',
          'Deletion requests may be fulfilled as suppression, moderation, correction, or retention of an audit placeholder depending on the public workflow record involved.',
        ],
      },
    ],
  },
  {
    id: 'telemetry',
    route: '/telemetry',
    eyebrow: 'Telemetry and Remote AI',
    title: 'Telemetry and Remote AI Consent',
    summary:
      'The Web PWA uses local-first behavior where possible. Remote AI fallback is opt-in when configured and can send article text to a remote AI server.',
    sections: [
      {
        heading: 'Remote AI fallback',
        body: [
          'When remote AI fallback is available, the Engine Settings toggle must remain off until the user opts in.',
          'Opting in can send article text and analysis context to a remote AI server to produce or repair analysis. Do not opt in for confidential, private, or sensitive source material.',
        ],
      },
      {
        heading: 'Operational telemetry',
        body: [
          'The beta records operational status needed for mesh writes, release gates, source health, model provenance, and deterministic QA reports.',
          'Telemetry and release reports must not be marketed as production monitoring, full cost governance, or complete privacy compliance.',
        ],
      },
    ],
  },
  {
    id: 'copyright',
    route: '/copyright',
    eyebrow: 'Content and Copyright',
    title: 'Content and Copyright Boundaries',
    summary:
      'VHC summarizes and links to news sources. The beta distinguishes analyzed sources from related links and does not grant rights to republish third-party content.',
    sections: [
      {
        heading: 'Source content',
        body: [
          'Headlines, summaries, frames, reframes, source evidence, related links, and user replies are provided for beta evaluation and civic discussion.',
          'Related links may be shown for context even when they were not used for the synthesis summary or frame/reframe table.',
        ],
      },
      {
        heading: 'Copyright and attribution',
        body: [
          'Do not paste full copyrighted articles into story replies, report reasons, or support requests.',
          'Report source attribution errors, infringing user content, or content boundary concerns through the beta operator contact channel or in-product report controls where appropriate.',
        ],
      },
    ],
  },
] as const;

export const REQUIRED_PUBLIC_BETA_COMPLIANCE_ROUTES = PUBLIC_BETA_COMPLIANCE_PAGES.map((page) => page.route);

export function getPublicBetaCompliancePage(pageId: PublicBetaCompliancePageId): PublicBetaCompliancePage {
  const page = PUBLIC_BETA_COMPLIANCE_PAGES.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new Error(`Unknown public beta compliance page: ${pageId}`);
  }
  return page;
}

export const ComplianceFooter: React.FC = () => (
  <footer
    className="mx-auto mt-6 max-w-6xl px-4 pb-6 text-xs text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8"
    data-testid="public-beta-compliance-footer"
  >
    <nav aria-label="Public beta policies" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200/80 pt-4 dark:border-slate-800">
      <Link to="/compliance" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Compliance
      </Link>
      <Link to="/beta" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Beta scope
      </Link>
      <Link to="/privacy" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Privacy
      </Link>
      <Link to="/terms" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Terms
      </Link>
      <Link to="/moderation" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Moderation
      </Link>
      <Link to="/support" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Support
      </Link>
      <Link to="/data-deletion" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Data deletion
      </Link>
      <Link to="/telemetry" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Telemetry
      </Link>
      <Link to="/copyright" className="font-medium hover:text-slate-800 dark:hover:text-slate-100">
        Copyright
      </Link>
    </nav>
  </footer>
);

export const PublicBetaComplianceIndex: React.FC = () => (
  <section
    className="space-y-5 rounded-[1.5rem] border border-slate-200/90 bg-white/84 p-5 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80"
    data-testid="public-beta-compliance-index"
  >
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        Public Beta Compliance
      </p>
      <h1 className="text-2xl font-semibold text-slate-950 dark:text-white">Public beta policy surfaces</h1>
      <p className="max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
        These pages define the minimum user-facing boundaries for the VHC Web PWA beta. They describe the implemented
        policy surface and the known limits that still block broader public launch claims.
      </p>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      {PUBLIC_BETA_COMPLIANCE_PAGES.map((page) => (
        <Link
          key={page.id}
          to={page.route}
          className="rounded-[1rem] border border-slate-200 bg-slate-50/80 p-4 transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/70 dark:hover:bg-slate-900"
          data-testid={`public-beta-compliance-index-link-${page.id}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            {page.eyebrow}
          </p>
          <h2 className="mt-1 text-base font-semibold text-slate-950 dark:text-white">{page.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{page.summary}</p>
        </Link>
      ))}
    </div>
  </section>
);

export const PublicBetaCompliancePageView: React.FC<{ pageId: PublicBetaCompliancePageId }> = ({ pageId }) => {
  const page = getPublicBetaCompliancePage(pageId);
  return (
    <article
      className="space-y-5 rounded-[1.5rem] border border-slate-200/90 bg-white/84 p-5 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80"
      data-testid={`public-beta-compliance-page-${page.id}`}
    >
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          {page.eyebrow}
        </p>
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white">{page.title}</h1>
        <p className="max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">{page.summary}</p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {page.sections.map((section) => (
          <section
            key={section.heading}
            className="space-y-2 rounded-[1rem] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/70"
          >
            <h2 className="text-sm font-semibold text-slate-950 dark:text-white">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 border-t border-slate-200/80 pt-4 text-sm dark:border-slate-800">
        <Link to="/compliance" className="font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
          All policy pages
        </Link>
        <Link to="/support" className="font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
          Support and contact
        </Link>
        <Link to="/moderation" className="font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
          UGC and moderation
        </Link>
      </div>
    </article>
  );
};
