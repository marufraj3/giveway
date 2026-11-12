/**
 * The access token is kept for this browser tab only: it is stored in
 * sessionStorage (cleared when the tab closes) and never sent anywhere except to
 * this application's own API, which forwards it to Meta in an Authorization header.
 */
const TOKEN_KEY = 'threadline.access-token';

export function readSessionToken(): string {
  if (typeof window === 'undefined') return '';
  try { return window.sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function writeSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  try { if (token) window.sessionStorage.setItem(TOKEN_KEY, token); else window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage may be unavailable */ }
}

export function clearSessionToken(): void {
  writeSessionToken('');
}
