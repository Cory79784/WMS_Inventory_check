interface VirtualKeyboard {
  show: () => void;
  hide: () => void;
}

export function scannerKeyboard(): VirtualKeyboard | undefined {
  const keyboard = (navigator as Navigator & { virtualKeyboard?: Partial<VirtualKeyboard> }).virtualKeyboard;
  return typeof keyboard?.show === 'function' && typeof keyboard.hide === 'function'
    ? keyboard as VirtualKeyboard : undefined;
}

// Keep scanner inputs editable. Explicit keyboard requests must remain in the click event.
export function focusScannerInput(input: HTMLInputElement | null, manual = false): void {
  if (!input) return;
  const android = /Android/i.test(navigator.userAgent);
  const keyboard = scannerKeyboard();
  input.readOnly = false;
  if (manual) input.inputMode = 'text';
  else if (android) input.removeAttribute('inputmode');
  else input.inputMode = 'none';
  input.setAttribute('virtualkeyboardpolicy', !manual && keyboard ? 'manual' : 'auto');

  if (manual) {
    // Re-focus inside the user gesture, after enabling the browser's ordinary keyboard path.
    input.blur();
    input.focus();
  } else if (document.activeElement !== input) {
    // Older Android browsers lack the API. This suppresses the focus-time keyboard request
    // where supported; restore editability immediately so the next scan is never blocked.
    input.readOnly = android && !keyboard;
    try { input.focus(); } finally { input.readOnly = false; }
  }
  try {
    if (manual) keyboard?.show();
    else keyboard?.hide();
  } catch {
    // The API is experimental; an unsupported/denied call must not break text input.
    input.setAttribute('virtualkeyboardpolicy', 'auto');
  }
}
