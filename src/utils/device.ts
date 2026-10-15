// UI presentation only: inventory APIs and historical snapshots stay unchanged.
// Do not infer mobile mode from width: a narrow desktop window keeps file tools.
export function isHandheldDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
