import React from 'react';
import { languageSafety } from '../i18n/safety';
import { persistLanguage, readLanguage, t, type Language } from '../i18n';

const options: Array<{ code: Language; label: string }> = [
  {code: 'zh', label: '中文'}, {code: 'ar', label: 'العربية'},
  {code: 'vi', label: 'Tiếng Việt'}, {code: 'de', label: 'Deutsch'},
];
export function LanguageSwitcher() {
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as Language;
    const current = readLanguage();
    if (current === next) return;
    const safety = languageSafety();
    if (safety.busy) { alert(t('busy')); event.target.value = current; return; }
    if (safety.dirty && !confirm(t('unsaved'))) { event.target.value = current; return; }
    if (!persistLanguage(next)) { alert(t('storageError')); event.target.value = current; return; }
    window.location.reload();
  };
  return <select dir="ltr" aria-label={t('language')} defaultValue={readLanguage()}
    onChange={handleChange} className="max-w-28 bg-slate-800 border border-slate-600 rounded text-white text-xs px-1 py-1">
    {options.map(option => <option value={option.code} key={option.code}>{option.label}</option>)}
  </select>;
}
