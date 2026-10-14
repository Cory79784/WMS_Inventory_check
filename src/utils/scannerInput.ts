interface VirtualKeyboard {
  show: () => void;
  hide: () => void;
}

export function scannerKeyboard(): VirtualKeyboard | undefined {
  const keyboard = (navigator as Navigator & { virtualKeyboard?: Partial<VirtualKeyboard> }).virtualKeyboard;
  return typeof keyboard?.show === 'function' && typeof keyboard.hide === 'function'
    ? keyboard as VirtualKeyboard : undefined;
}

// The input stays editable for physical/IME scanner input in both modes.
// Manual mode must be entered synchronously from the keyboard button's click.
export function focusScannerInput(input: HTMLInputElement | null, manual = false): void {
  if (!input) return;
  const keyboard = scannerKeyboard();
  // Refocus after a mode change: Android may retain the keyboard choice of an
  // already-focused input. Blur also dismisses the previous manual keyboard.
  if (manual || input.inputMode !== 'none') input.blur();
  input.readOnly = false;
  input.inputMode = manual ? 'text' : 'none';
  input.setAttribute('virtualkeyboardpolicy', !manual && keyboard ? 'manual' : 'auto');
  input.focus({ preventScroll: true });
  // Standard text-mode focus opens manual input without an experimental API.
  // A best-effort hide must never change scanner attributes or disable editing.
  if (!manual) {
    try { keyboard?.hide(); } catch { /* inputMode and blur remain the fallback */ }
  }
}
