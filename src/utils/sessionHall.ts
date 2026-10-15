import type { HallId } from '../types';

const KEY = 'wms-active-hall';

// Tab-scoped: survives refresh, but is not a permanent device preference.
export function readSessionHall(): HallId {
  try {
    const hall = window.sessionStorage.getItem(KEY);
    return hall === 'H1' || hall === 'H2' || hall === 'H3' ? hall : 'H1';
  } catch { return 'H1'; }
}

export function rememberSessionHall(hall: HallId): void {
  try { window.sessionStorage.setItem(KEY, hall); } catch { /* Storage may be disabled. */ }
}

export function clearSessionHall(): void {
  try { window.sessionStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
}
