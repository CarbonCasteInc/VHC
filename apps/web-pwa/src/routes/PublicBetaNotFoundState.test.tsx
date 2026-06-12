/* @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { PublicBetaNotFoundState } from './PublicBetaNotFoundState';

describe('PublicBetaNotFoundState', () => {
  it('renders a public-beta-safe not found state with feed and support exits', () => {
    render(<PublicBetaNotFoundState />);

    const state = screen.getByTestId('public-beta-not-found');
    expect(within(state).getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(within(state).getByText(/not part of the public news beta surface/i)).toBeInTheDocument();
    expect(within(state).getByRole('link', { name: 'Back to feed' })).toHaveAttribute('href', '/');
    expect(within(state).getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
  });
});
