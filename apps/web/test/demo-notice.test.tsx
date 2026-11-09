import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoNotice } from '../src/features/demo/DemoNotice';

describe('demo notice (F9, US4)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('warns that the demo has no backups and holds test data only', () => {
    vi.stubEnv('VITE_DEMO_NOTICE', 'true');
    render(<DemoNotice />);
    const notice = screen.getByRole('note');
    expect(notice.textContent?.toLowerCase()).toContain('demo sin copias de seguridad');
    expect(notice.textContent?.toLowerCase()).toContain('solo datos de prueba');
  });

  it.each(['false', '', undefined])('shows nothing when the deployment sets %s', (value) => {
    vi.stubEnv('VITE_DEMO_NOTICE', value);
    render(<DemoNotice />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
