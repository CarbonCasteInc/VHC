/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PresenceBar } from './PresenceBar';
import type { CollabPeer } from '../../store/hermesDocsCollab';

describe('PresenceBar', () => {
  afterEach(() => cleanup());

  it('renders nothing when no peers', () => {
    render(<PresenceBar peers={new Map()} myNullifier="me" />);
    expect(screen.queryByTestId('presence-bar')).not.toBeInTheDocument();
  });

  it('renders nothing when only self is peer', () => {
    const peers = new Map<number, CollabPeer>([
      [1, { nullifier: 'me', displayName: 'Me' }],
    ]);
    render(<PresenceBar peers={peers} myNullifier="me" />);
    expect(screen.queryByTestId('presence-bar')).not.toBeInTheDocument();
  });

  it('renders peers excluding self', () => {
    const peers = new Map<number, CollabPeer>([
      [1, { nullifier: 'me', displayName: 'Me' }],
      [2, { nullifier: 'alice', displayName: 'Alice', color: '#f00' }],
      [3, { nullifier: 'bob' }],
    ]);
    render(<PresenceBar peers={peers} myNullifier="me" />);
    expect(screen.getByTestId('presence-bar')).toBeInTheDocument();
    expect(screen.getByTestId('peer-2')).toHaveTextContent('Alice');
    expect(screen.getByTestId('peer-3')).toHaveTextContent('bob');
  });

  it('shows cursor indicator when peer has cursor', () => {
    const peers = new Map<number, CollabPeer>([
      [5, { nullifier: 'carol', cursor: { anchor: 0, head: 10 } }],
    ]);
    render(<PresenceBar peers={peers} myNullifier="me" />);
    expect(screen.getByTestId('cursor-5')).toBeInTheDocument();
  });

  it('uses nullifier prefix when no displayName', () => {
    const peers = new Map<number, CollabPeer>([
      [7, { nullifier: 'abcdefghijklmnop' }],
    ]);
    render(<PresenceBar peers={peers} myNullifier="me" />);
    expect(screen.getByTestId('peer-7')).toHaveTextContent('abcdefgh');
  });

  it('applies explicit color', () => {
    const peers = new Map<number, CollabPeer>([
      [8, { nullifier: 'dave', color: '#00ff00' }],
    ]);
    render(<PresenceBar peers={peers} myNullifier="me" />);
    const dot = screen.getByTestId('peer-8').querySelector('span');
    expect(dot).toHaveStyle({ backgroundColor: '#00ff00' });
  });

  it('uses palette fallback when no explicit color', () => {
    const peers = new Map<number, CollabPeer>([
      [9, { nullifier: 'eve' }],
    ]);
    render(<PresenceBar peers={peers} myNullifier="me" />);
    const dot = screen.getByTestId('peer-9').querySelector('span');
    expect(dot).toHaveStyle({ backgroundColor: '#6366f1' });
  });
});
