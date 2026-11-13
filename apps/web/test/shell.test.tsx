import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID, openApp, signedIn } from './route-harness';

const OWNER_DESTINATIONS = ['Workflows', 'Ejecuciones', 'Aprobaciones', 'Conexiones', 'Miembros'];

function destinationNames(nav: HTMLElement) {
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent?.replace(/\d+$/, '').trim());
}

describe('application shell (FR-008, FR-011)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists the five destinations in order in the rail and in the bottom bar', async () => {
    openApp(`/orgs/${ORG_ID}/workflows`, signedIn('owner'));
    const rail = await screen.findByRole('navigation', { name: 'Navegación principal' });
    const bottom = screen.getByRole('navigation', { name: 'Navegación inferior' });
    expect(destinationNames(rail)).toEqual(OWNER_DESTINATIONS);
    expect(destinationNames(bottom)).toEqual(OWNER_DESTINATIONS);
  });

  it('hides the destinations a viewer cannot use', async () => {
    openApp(`/orgs/${ORG_ID}/workflows`, signedIn('viewer'));
    const rail = await screen.findByRole('navigation', { name: 'Navegación principal' });
    expect(destinationNames(rail)).toEqual(['Workflows', 'Ejecuciones', 'Miembros']);
  });

  it('marks the active destination with aria-current and a filled glyph', async () => {
    openApp(`/orgs/${ORG_ID}/workflows`, signedIn('owner'));
    const rail = await screen.findByRole('navigation', { name: 'Navegación principal' });
    const active = within(rail).getByRole('link', { current: 'page' });
    expect(active.textContent).toContain('Workflows');
    expect(active.querySelector('svg[data-filled="true"]')).not.toBeNull();
    const others = within(rail)
      .getAllByRole('link')
      .filter((link) => link !== active);
    for (const link of others) {
      expect(link.getAttribute('aria-current')).toBeNull();
      expect(link.querySelector('svg[data-filled="true"]')).toBeNull();
    }
  });

  it('puts the skip link first in the focus order and targets the only main', async () => {
    openApp(`/orgs/${ORG_ID}/workflows`, signedIn('owner'));
    await screen.findByRole('navigation', { name: 'Navegación principal' });
    const firstFocusable = document.querySelector<HTMLElement>('a[href], button, input, select');
    expect(firstFocusable?.textContent).toBe('Saltar al contenido');
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(firstFocusable?.getAttribute('href')).toBe(`#${mains[0]?.id}`);

    await userEvent.setup().tab();
    expect(document.activeElement).toBe(firstFocusable);
  });

  it('keeps the header free of whitespace-nowrap so it cannot overflow the window', async () => {
    openApp(`/orgs/${ORG_ID}/workflows`, signedIn('owner'));
    // PageHeader is a <header> too: the shell's own comes first in the document.
    const header = (await screen.findAllByRole('banner'))[0]!;
    expect(header.className).not.toMatch(/whitespace-nowrap/);
    expect(header.querySelector('.whitespace-nowrap')).toBeNull();
  });

  it('offers the three theme options in the user menu', async () => {
    openApp(`/orgs/${ORG_ID}/workflows`, signedIn('owner'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /menú de usuario/i }));
    expect(await screen.findByRole('menuitemradio', { name: /^Sistema/ })).toBeDefined();
    expect(screen.getByRole('menuitemradio', { name: 'Claro' })).toBeDefined();
    expect(screen.getByRole('menuitemradio', { name: 'Oscuro' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeDefined();
  });
});
