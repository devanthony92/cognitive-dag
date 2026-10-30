/**
 * The invitation a person is in the middle of accepting. Someone without an account leaves the
 * link to register, verifies their email in another tab and signs in later, so it has to outlive
 * the tab: `localStorage`. The token is single use, bound to the invited email and expires, and it
 * is removed as soon as the invitation is accepted or rejected.
 */
const KEY = 'pending-invitation';

export interface PendingInvitation {
  token: string;
  /** The invited email, known after the preview; prefills the registration form. */
  email?: string;
}

export function readPendingInvitation(): PendingInvitation | undefined {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const { token, email } = value as Record<string, unknown>;
    if (typeof token !== 'string') return undefined;
    return typeof email === 'string' ? { token, email } : { token };
  } catch {
    // Storage can be unavailable (private mode, blocked site data): the flow still works in-tab.
    return undefined;
  }
}

export function rememberPendingInvitation(invitation: PendingInvitation): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(invitation));
  } catch {
    // See readPendingInvitation.
  }
}

export function clearPendingInvitation(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // See readPendingInvitation.
  }
}
