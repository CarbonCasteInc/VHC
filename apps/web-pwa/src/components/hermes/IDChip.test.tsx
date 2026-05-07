/* @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDChip } from './IDChip';

const IDENTITY_DIRECTORY_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const writeText = vi.fn(async () => undefined);
let identity: unknown = null;

vi.mock('react-qr-code', () => ({
  default: ({ value }: { value: string }) => <output data-testid="qr-value">{value}</output>
}));

vi.mock('@vh/types', () => ({
  deriveIdentityDirectoryKey: vi.fn(async () => IDENTITY_DIRECTORY_KEY)
}));

vi.mock('../../hooks/useIdentity', () => ({
  useIdentity: () => ({ identity })
}));

describe('IDChip', () => {
  beforeEach(() => {
    identity = {
      session: { nullifier: 'raw-principal-nullifier' },
      devicePair: { epub: 'alice-epub' },
      handle: 'alice'
    };
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    writeText.mockClear();
  });

  afterEach(() => cleanup());

  it('encodes the LUMA identity directory key instead of the raw nullifier', async () => {
    render(<IDChip />);

    await waitFor(() => expect(screen.getByTestId('idchip-label')).toHaveTextContent(
      `@alice • ${IDENTITY_DIRECTORY_KEY.slice(0, 10)}`
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }));

    const encoded = screen.getByTestId('idchip-data').textContent ?? '';
    expect(JSON.parse(encoded)).toEqual({
      identityDirectoryKey: IDENTITY_DIRECTORY_KEY,
      epub: 'alice-epub',
      handle: 'alice'
    });
    expect(encoded).not.toContain('raw-principal-nullifier');
    expect(encoded).not.toContain('"nullifier"');
    expect(screen.getByTestId('qr-value')).toHaveTextContent(IDENTITY_DIRECTORY_KEY);

    fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(encoded));
  });

  it('omits invalid handles from the public contact payload', async () => {
    identity = {
      session: { nullifier: 'raw-principal-nullifier' },
      devicePair: { epub: 'alice-epub' },
      handle: 'not valid'
    };

    render(<IDChip />);

    await waitFor(() => expect(screen.getByTestId('idchip-label')).toHaveTextContent('@anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }));

    expect(JSON.parse(screen.getByTestId('idchip-data').textContent ?? '{}')).toEqual({
      identityDirectoryKey: IDENTITY_DIRECTORY_KEY,
      epub: 'alice-epub'
    });
  });
});
