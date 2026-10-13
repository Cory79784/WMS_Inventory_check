import { zh, type TranslationKey } from './zh';
import { ar } from './ar';
import { vi } from './vi';
import { de } from './de';
export type Language = 'zh' | 'ar' | 'vi' | 'de';
export const STORAGE_KEY = 'wms_pda_language';
const languages = { zh, ar, vi, de };
export function readLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'zh' || value === 'ar' || value === 'vi' || value === 'de' ? value : 'zh';
  } catch { return 'zh'; }
}
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template = languages[readLanguage()][key];
  return params ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? '{' + name + '}')) : template;
}
export function persistLanguage(language: Language): boolean {
  try { localStorage.setItem(STORAGE_KEY, language); return true; } catch { return false; }
}
