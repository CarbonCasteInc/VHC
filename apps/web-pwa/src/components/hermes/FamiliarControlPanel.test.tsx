/* @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { FamiliarControlPanel } from './FamiliarControlPanel';
import { useDelegationStore } from '../../store/delegation';
import { clearPublishedIdentity } from '../../store/identityProvider';
import { useXpLedger } from '../../store/xpLedger';

const BASE_TIME = 1_700_001_000_000;

function resetState(): void {
  localStorage.clear();
  clearPublishedIdentity();
  useDelegationStore.getState().setActivePrincipal(null);
  useXpLedger.getState().setActiveNullifier(null);
}

function renderPanel(now: () => number = () => BASE_TIME) {
  return render(<FamiliarControlPanel principalOverride="principal-1" now={now} />);
}

function renderNullPrincipalPanel(now: () => number = () => BASE_TIME) {
  return render(<FamiliarControlPanel principalOverride={null} now={now} />);
}

describe('FamiliarControlPanel', () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    cleanup();
  });

  it('validates familiar and grant form inputs', () => {
    renderPanel();

    expect(screen.getByTestId('principal-nullifier')).toHaveTextContent('principal-1');
    expect(screen.getByTestId('empty-active-grants')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('create-grant-button'));
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'Select a familiar before creating a grant.'
    );

    fireEvent.click(screen.getByTestId('register-familiar-button'));
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent('Familiar label is required.');

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Scout' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    expect(screen.getByTestId('familiar-control-notice')).toHaveTextContent('Familiar Scout registered.');

    fireEvent.change(screen.getByTestId('grant-duration-input'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'Grant duration must be a positive number of minutes.'
    );
  });

  it('creates and revokes active grants', () => {
    renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Writer' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'suggest' } });
    fireEvent.change(screen.getByTestId('grant-duration-input'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));

    expect(screen.getByTestId('active-grants-list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(screen.getByTestId('familiar-control-notice')).toHaveTextContent('revoked.');
    expect(screen.getByTestId('empty-active-grants')).toBeInTheDocument();
  });

  it('runs high-impact approval flow with cancel and confirm actions', () => {
    renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Moderator' } });
    fireEvent.change(screen.getByTestId('familiar-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-high-impact-button'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('familiar-control-notice')).toHaveTextContent(
      'High-impact grant request cancelled.'
    );
    expect(screen.getByTestId('empty-active-grants')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('create-grant-button'));
    fireEvent.click(screen.getByTestId('confirm-high-impact-button'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-grants-list')).toBeInTheDocument();
    expect(screen.getByText(/moderate, vote, fund, civic_action/)).toBeInTheDocument();
    expect(
      useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'moderation/day')?.count
    ).toBe(1);
  });

  it('denies high-impact grant creation when budget guards are exhausted', () => {
    act(() => {
      const ledger = useXpLedger.getState();
      ledger.setActiveNullifier('principal-1');
      for (let index = 0; index < 10; index += 1) {
        ledger.consumeAction('moderation/day');
      }
    });

    renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Moderator' } });
    fireEvent.change(screen.getByTestId('familiar-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'High-impact grant denied: Daily limit of 10 reached for moderation/day'
    );
  });

  it('re-checks moderation/day budget at confirm time (TOCTOU guard)', () => {
    act(() => {
      const ledger = useXpLedger.getState();
      ledger.setActiveNullifier('principal-1');
      for (let index = 0; index < 9; index += 1) {
        ledger.consumeAction('moderation/day');
      }
    });

    renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Moderator' } });
    fireEvent.change(screen.getByTestId('familiar-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      useXpLedger.getState().consumeAction('moderation/day');
    });

    fireEvent.click(screen.getByTestId('confirm-high-impact-button'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'High-impact grant denied: Daily limit of 10 reached for moderation/day'
    );
    expect(screen.getByTestId('empty-active-grants')).toBeInTheDocument();
    expect(
      useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'moderation/day')?.count
    ).toBe(10);
  });

  it('uses fallback civic budget denial reason when guard omits details', () => {
    const originalCanPerformAction = useXpLedger.getState().canPerformAction;

    act(() => {
      useXpLedger.setState((state) => ({
        ...state,
        canPerformAction: ((action: Parameters<typeof originalCanPerformAction>[0]) => {
          if (action === 'moderation/day') {
            return { allowed: true };
          }
          if (action === 'civic_actions/day') {
            return { allowed: false };
          }
          return originalCanPerformAction(action);
        }) as typeof originalCanPerformAction
      }));
    });

    renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Fallback' } });
    fireEvent.change(screen.getByTestId('familiar-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));

    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'High-impact grant denied: civic_actions/day budget denied'
    );

    act(() => {
      useXpLedger.setState((state) => ({
        ...state,
        canPerformAction: originalCanPerformAction
      }));
    });
  });

  it('uses fallback moderation budget denial reason when guard omits details', () => {
    const originalCanPerformAction = useXpLedger.getState().canPerformAction;

    act(() => {
      useXpLedger.setState((state) => ({
        ...state,
        canPerformAction: ((action: Parameters<typeof originalCanPerformAction>[0]) => {
          if (action === 'moderation/day') {
            return { allowed: false };
          }
          return originalCanPerformAction(action);
        }) as typeof originalCanPerformAction
      }));
    });

    renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Fallback' } });
    fireEvent.change(screen.getByTestId('familiar-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));

    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'High-impact grant denied: moderation/day budget denied'
    );

    act(() => {
      useXpLedger.setState((state) => ({
        ...state,
        canPerformAction: originalCanPerformAction
      }));
    });
  });

  it('falls back to Date.now when no now prop is provided', () => {
    render(<FamiliarControlPanel principalOverride="principal-1" />);
    expect(screen.getByTestId('principal-nullifier')).toHaveTextContent('principal-1');
  });

  it('surfaces delegation write failures and reconciles familiar selection state', () => {
    renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'Suggest-only' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-familiar-select'), { target: { value: '' } });
    const familiarSelect = screen.getByTestId('grant-familiar-select') as HTMLSelectElement;
    expect(familiarSelect.value).not.toBe('');

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'act' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'Scope "analyze" exceeds familiar tier "suggest"'
    );

    const familiarId = Object.keys(useDelegationStore.getState().familiarsById)[0]!;
    act(() => {
      useDelegationStore.getState().revokeFamiliar(familiarId, BASE_TIME + 10);
    });

    expect((screen.getByTestId('grant-familiar-select') as HTMLSelectElement).value).toBe('');
  });

  it('handles register/revoke/high-impact confirm failures', () => {
    renderNullPrincipalPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'No Principal' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent('No active principal set');

    cleanup();
    const view = renderPanel();

    fireEvent.change(screen.getByTestId('familiar-label-input'), { target: { value: 'HiImpact' } });
    fireEvent.change(screen.getByTestId('familiar-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('register-familiar-button'));

    fireEvent.change(screen.getByTestId('grant-tier-select'), { target: { value: 'high-impact' } });
    fireEvent.click(screen.getByTestId('create-grant-button'));
    fireEvent.click(screen.getByTestId('confirm-high-impact-button'));

    view.rerender(<FamiliarControlPanel principalOverride="principal-1" now={() => Number.NaN} />);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent(
      'revokedAt must be a non-negative integer timestamp, got: NaN'
    );

    fireEvent.click(screen.getByTestId('create-grant-button'));
    fireEvent.click(screen.getByTestId('confirm-high-impact-button'));
    expect(screen.getByTestId('familiar-control-error')).toHaveTextContent('issuedAt');
  });
});
