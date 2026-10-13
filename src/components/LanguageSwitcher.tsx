import React from 'react';
import { readLanguage, t, type Language } from '../i18n';
import { switchLanguage } from '../i18n/switch';

const options: Array<{ code: Language; label: string }> = [
  {code: 'zh', label: '中文'}, {code: 'ar', label: 'العربية'},
  {code: 'vi', label: 'Tiếng Việt'}, {code: 'de', label: 'Deutsch'},
];
export function LanguageSwitcher() {
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as Language;
    const current = readLanguage();
    if (!switchLanguage(next)) event.currentTarget.value = current;
  };
  return <select dir="ltr" aria-label={t('language')} defaultValue={readLanguage()}
    onChange={handleChange} className="max-w-28 bg-slate-800 border border-slate-600 rounded text-white text-xs px-1 py-1">
    {options.map(option => <option value={option.code} key={option.code}>{option.label}</option>)}
  </select>;
}
