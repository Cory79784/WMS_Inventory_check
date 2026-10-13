import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLanguage, t, persistLanguage, STORAGE_KEY, type Language } from '../src/i18n';
import { registerLanguageSafety } from '../src/i18n/safety';
import { switchLanguage } from '../src/i18n/switch';

const storage = new Map<string, string>();
const cleanup: Array<() => void> = [];
const reload = vi.fn();
const ask = vi.fn(() => true);
const notify = vi.fn();

beforeEach(() => {
  storage.clear();
  reload.mockClear();
  ask.mockClear();
  notify.mockClear();
  ask.mockReturnValue(true);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  vi.unstubAllGlobals();
});
const change = (lang: Language) => switchLanguage(lang, { ask, notify, reload });
const guard = (dirty: boolean, busy: boolean) => cleanup.push(registerLanguageSafety('test', { dirty: () => dirty, busy: () => busy }));

describe('PDA language selection', () => {
  it('starts in Chinese and persists each supported language', () => {
    expect(readLanguage()).toBe('zh');
    for (const lang of ['ar', 'vi', 'de', 'zh'] as Language[]) {
      expect(persistLanguage(lang)).toBe(true);
      expect(readLanguage()).toBe(lang);
      expect(storage.get(STORAGE_KEY)).toBe(lang);
    }
  });
  it('restores the selection and falls back safely for invalid storage', () => {
    storage.set(STORAGE_KEY, 'vi');
    expect(readLanguage()).toBe('vi');
    storage.set(STORAGE_KEY, '<script>');
    expect(readLanguage()).toBe('zh');
  });
  it('falls back to Chinese if reading browser storage fails', () => {
    vi.stubGlobal('localStorage', {getItem: () => { throw new Error('blocked'); }});
    expect(readLanguage()).toBe('zh');
    expect(t('inspect')).toBe('库位核查');
  });
  it('renders translated UI labels and contains Arabic text in an RTL isolate', () => {
    expect(t('warehouse')).toContain('库存核查');
    storage.set(STORAGE_KEY, 'ar');
    expect(t('warehouse')).toMatch(/^\u2067.*\u2069$/u);
    expect(t('inspect')).toContain('فحص');
    storage.set(STORAGE_KEY, 'vi');
    expect(t('inspect')).toContain('Kiểm tra');
    storage.set(STORAGE_KEY, 'de');
    expect(t('inspect')).toContain('prüfen');
  });
  it('reloads exactly once after switching with no draft', () => {
    expect(change('de')).toBe(true);
    expect(readLanguage()).toBe('de');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });
  it('does not reload when the selected language is unchanged', () => {
    expect(change('zh')).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });
  it('asks before losing unsaved data and leaves the language unchanged when cancelled', () => {
    guard(true, false);
    ask.mockReturnValue(false);
    expect(change('ar')).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(readLanguage()).toBe('zh');
  });
  it('allows a confirmed change and only then stores the new language', () => {
    guard(true, false);
    expect(change('vi')).toBe(true);
    expect(readLanguage()).toBe('vi');
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('blocks language switching during uploads, saves or unsafe async tasks', () => {
    guard(false, true);
    expect(change('ar')).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(readLanguage()).toBe('zh');
  });
  it('disables switching when browser storage rejects writes', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    });
    expect(change('de')).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
