/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComplianceFooter,
  PUBLIC_BETA_COMPLIANCE_PAGES,
  PublicBetaComplianceIndex,
  PublicBetaCompliancePageView,
  REQUIRED_PUBLIC_BETA_COMPLIANCE_ROUTES,
} from './publicBetaCompliance';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

describe('public beta compliance surfaces', () => {
  afterEach(() => cleanup());

  it('declares every required beta compliance route exactly once', () => {
    expect(REQUIRED_PUBLIC_BETA_COMPLIANCE_ROUTES).toEqual([
      '/beta',
      '/privacy',
      '/terms',
      '/moderation',
      '/support',
      '/data-deletion',
      '/telemetry',
      '/copyright',
    ]);
    expect(new Set(REQUIRED_PUBLIC_BETA_COMPLIANCE_ROUTES).size).toBe(REQUIRED_PUBLIC_BETA_COMPLIANCE_ROUTES.length);
  });

  it('renders an index link for every compliance page', () => {
    render(<PublicBetaComplianceIndex />);

    for (const page of PUBLIC_BETA_COMPLIANCE_PAGES) {
      const link = screen.getByTestId(`public-beta-compliance-index-link-${page.id}`);
      expect(link).toHaveAttribute('href', page.route);
      expect(link).toHaveTextContent(page.title);
    }
  });

  it('renders each policy page with non-empty sections and beta-limited copy', () => {
    for (const page of PUBLIC_BETA_COMPLIANCE_PAGES) {
      const { unmount } = render(<PublicBetaCompliancePageView pageId={page.id} />);

      expect(screen.getByTestId(`public-beta-compliance-page-${page.id}`)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: page.title })).toBeInTheDocument();
      for (const section of page.sections) {
        expect(screen.getByRole('heading', { name: section.heading })).toBeInTheDocument();
      }
      expect(screen.getByRole('link', { name: /all policy pages/i })).toHaveAttribute('href', '/compliance');
      unmount();
    }
  });

  it('keeps global footer links aligned with required routes', () => {
    render(<ComplianceFooter />);

    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    for (const route of REQUIRED_PUBLIC_BETA_COMPLIANCE_ROUTES) {
      expect(links).toContain(route);
    }
  });

  it('does not overclaim beta identity or moderation readiness', () => {
    const text = JSON.stringify(PUBLIC_BETA_COMPLIANCE_PAGES).toLowerCase();

    expect(text).not.toContain('one-human-one-vote assurance is active');
    expect(text).not.toContain('verified-human system is active');
    expect(text).not.toContain('complete trust-and-safety program is implemented');
    expect(text).toContain('not a full moderation operations program');
    expect(text).toContain('beta-local');
  });
});
