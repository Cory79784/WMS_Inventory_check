import type { HallId } from '../types';

const KEY = 'wms-active-hall';

// Device preference: survives refresh and closing/reopening the browser.
export function readSessionHall(): HallId {
  try {
    const hall = window.localStorage.getItem(KEY);
    return hall === 'H1' || hall === 'H2' || hall === 'H3' ? hall : 'H1';
  } catch { return 'H1'; }
}

export function rememberSessionHall(hall: HallId): void {
  try { window.localStorage.setItem(KEY, hall); } catch { window.dispatchEvent(new window.Event('wms-draft-storage-error')); }
}

export function clearSessionHall(): void {
  try { window.localStorage.removeItem(KEY); } catch { window.dispatchEvent(new window.Event('wms-draft-storage-error')); }
}
