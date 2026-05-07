/* @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanContact } from './ScanContact';

const lookupByIdentityDirectoryKey = vi.fn();
const getOrCreateChannel = vi.fn();
const navigate = vi.fn();
const client = { kind: 'client' };

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate })
}));

vi.mock('@vh/gun-client', () => ({
  lookupByIdentityDirectoryKey: (...args: unknown[]) => lookupByIdentityDirectoryKey(...args)
}));

vi.mock('../../store/hermesMessaging', () => ({
  useChatStore: () => ({ getOrCreateChannel })
}));

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { client: unknown }) => unknown) => selector({ client })
}));

describe('ScanContact', () => {
  beforeEach(() => {
    lookupByIdentityDirectoryKey.mockResolvedValue({
      identityDirectoryKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      devicePub: 'peer-device-pub',
      epub: 'directory-epub'
    });
    getOrCreateChannel.mockResolvedValue({ id: 'channel-1' });
    getOrCreateChannel.mockClear();
    navigate.mockReset();
  });

  afterEach(() => cleanup());

  it('looks up contacts by identityDirectoryKey and starts a channel without raw nullifier input', async () => {
    render(<ScanContact />);

    const contactPayload = JSON.stringify({
      identityDirectoryKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      epub: 'qr-epub',
      handle: 'Alice'
    });
    fireEvent.change(screen.getByTestId('contact-key-input'), { target: { value: contactPayload } });
    fireEvent.click(screen.getByTestId('start-chat-btn'));

    await waitFor(() => expect(lookupByIdentityDirectoryKey).toHaveBeenCalledWith(
      client,
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    ));
    expect(getOrCreateChannel).toHaveBeenCalledWith(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'qr-epub',
      'peer-device-pub',
      'Alice'
    );
    expect(navigate).toHaveBeenCalledWith({
      to: '/hermes/messages/$channelId',
      params: { channelId: 'channel-1' }
    });
    expect(JSON.stringify(getOrCreateChannel.mock.calls)).not.toContain('"nullifier"');
  });

  it('treats manual plain text as an identity directory key and fails closed when no v1 record exists', async () => {
    lookupByIdentityDirectoryKey.mockResolvedValueOnce(null);

    render(<ScanContact />);

    fireEvent.change(screen.getByTestId('contact-key-input'), { target: { value: 'plain-key' } });
    fireEvent.click(screen.getByTestId('start-chat-btn'));

    await waitFor(() => expect(screen.getByText(/Recipient not found in directory/)).toBeInTheDocument());
    expect(lookupByIdentityDirectoryKey).toHaveBeenCalledWith(client, 'plain-key');
    expect(getOrCreateChannel).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
