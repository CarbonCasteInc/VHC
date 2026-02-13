/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareModal, type Collaborator } from './ShareModal';

describe('ShareModal', () => {
  afterEach(() => cleanup());

  const baseProps = {
    docId: 'doc-1',
    isOpen: true,
    onClose: vi.fn(),
    existingCollaborators: [] as Collaborator[],
    ownerNullifier: 'owner-null',
    trustScore: 0.8,
    onShareKey: vi.fn(),
    onRemove: vi.fn(),
  };

  it('renders nothing when isOpen=false', () => {
    render(<ShareModal {...baseProps} isOpen={false} />);
    expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();
  });

  it('renders modal when isOpen=true', () => {
    render(<ShareModal {...baseProps} />);
    expect(screen.getByTestId('share-modal')).toBeInTheDocument();
    expect(screen.getByTestId('share-title')).toHaveTextContent('Share Document');
  });

  it('shows "No collaborators yet" when empty', () => {
    render(<ShareModal {...baseProps} />);
    expect(screen.getByTestId('no-collaborators')).toHaveTextContent('No collaborators yet');
  });

  it('lists existing collaborators', () => {
    const collabs: Collaborator[] = [
      { nullifier: 'alice', role: 'editor', displayName: 'Alice' },
      { nullifier: 'bob', role: 'viewer' },
    ];
    render(<ShareModal {...baseProps} existingCollaborators={collabs} />);
    expect(screen.getByTestId('collab-alice')).toHaveTextContent('Alice');
    expect(screen.getByTestId('collab-bob')).toBeInTheDocument();
  });

  it('calls onShareKey when adding collaborator', async () => {
    const onShareKey = vi.fn();
    render(<ShareModal {...baseProps} onShareKey={onShareKey} />);

    fireEvent.change(screen.getByTestId('share-nullifier-input'), {
      target: { value: 'new-collab' },
    });
    fireEvent.click(screen.getByTestId('share-add-btn'));

    await waitFor(() => {
      expect(onShareKey).toHaveBeenCalledWith('new-collab', 'editor');
    });
  });

  it('allows selecting viewer role', async () => {
    const onShareKey = vi.fn();
    render(<ShareModal {...baseProps} onShareKey={onShareKey} />);

    fireEvent.change(screen.getByTestId('share-role-select'), {
      target: { value: 'viewer' },
    });
    fireEvent.change(screen.getByTestId('share-nullifier-input'), {
      target: { value: 'viewer-collab' },
    });
    fireEvent.click(screen.getByTestId('share-add-btn'));

    await waitFor(() => {
      expect(onShareKey).toHaveBeenCalledWith('viewer-collab', 'viewer');
    });
  });

  it('shows error for empty nullifier', () => {
    render(<ShareModal {...baseProps} />);
    fireEvent.click(screen.getByTestId('share-add-btn'));
    expect(screen.getByTestId('share-error')).toHaveTextContent('Nullifier is required');
  });

  it('shows error when adding self', () => {
    render(<ShareModal {...baseProps} />);
    fireEvent.change(screen.getByTestId('share-nullifier-input'), {
      target: { value: 'owner-null' },
    });
    fireEvent.click(screen.getByTestId('share-add-btn'));
    expect(screen.getByTestId('share-error')).toHaveTextContent('Cannot add yourself');
  });

  it('shows error for duplicate collaborator', () => {
    const collabs: Collaborator[] = [{ nullifier: 'alice', role: 'editor' }];
    render(<ShareModal {...baseProps} existingCollaborators={collabs} />);

    fireEvent.change(screen.getByTestId('share-nullifier-input'), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByTestId('share-add-btn'));
    expect(screen.getByTestId('share-error')).toHaveTextContent('Already a collaborator');
  });

  it('shows trust warning when trust too low', () => {
    render(<ShareModal {...baseProps} trustScore={0.3} trustThreshold={0.5} />);
    expect(screen.getByTestId('trust-warning')).toBeInTheDocument();
  });

  it('blocks add when trust too low (button disabled)', () => {
    render(<ShareModal {...baseProps} trustScore={0.3} />);
    expect(screen.getByTestId('share-add-btn')).toBeDisabled();
    expect(screen.getByTestId('share-nullifier-input')).toBeDisabled();
  });

  it('disables add button at max collaborators', () => {
    const collabs = Array.from({ length: 10 }, (_, i) => ({
      nullifier: `collab-${i}`,
      role: 'editor' as const,
    }));
    render(<ShareModal {...baseProps} existingCollaborators={collabs} />);
    expect(screen.getByTestId('share-add-btn')).toBeDisabled();
  });

  it('calls onRemove when removing collaborator', () => {
    const onRemove = vi.fn();
    const collabs: Collaborator[] = [{ nullifier: 'alice', role: 'editor' }];
    render(<ShareModal {...baseProps} existingCollaborators={collabs} onRemove={onRemove} />);

    fireEvent.click(screen.getByTestId('remove-alice'));
    expect(onRemove).toHaveBeenCalledWith('alice');
  });

  it('calls onClose when Done clicked', () => {
    const onClose = vi.fn();
    render(<ShareModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('share-close-btn'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    render(<ShareModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('share-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when modal content clicked', () => {
    const onClose = vi.fn();
    render(<ShareModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('share-modal'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows error when onShareKey throws', async () => {
    const onShareKey = vi.fn().mockRejectedValue(new Error('Network fail'));
    render(<ShareModal {...baseProps} onShareKey={onShareKey} />);

    fireEvent.change(screen.getByTestId('share-nullifier-input'), {
      target: { value: 'new-collab' },
    });
    fireEvent.click(screen.getByTestId('share-add-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('share-error')).toHaveTextContent('Network fail');
    });
  });

  it('shows generic error when onRemove throws', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('fail'));
    const collabs: Collaborator[] = [{ nullifier: 'alice', role: 'editor' }];
    render(<ShareModal {...baseProps} existingCollaborators={collabs} onRemove={onRemove} />);

    fireEvent.click(screen.getByTestId('remove-alice'));
    await waitFor(() => {
      expect(screen.getByTestId('share-error')).toHaveTextContent('Failed to remove');
    });
  });

  it('clears nullifier input after successful add', async () => {
    const onShareKey = vi.fn();
    render(<ShareModal {...baseProps} onShareKey={onShareKey} />);

    fireEvent.change(screen.getByTestId('share-nullifier-input'), {
      target: { value: 'new-collab' },
    });
    fireEvent.click(screen.getByTestId('share-add-btn'));

    await waitFor(() => {
      const input = screen.getByTestId('share-nullifier-input') as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  it('uses default trust threshold 0.5', () => {
    render(<ShareModal {...baseProps} trustScore={0.4} trustThreshold={undefined} />);
    expect(screen.getByTestId('trust-warning')).toBeInTheDocument();
  });
});
