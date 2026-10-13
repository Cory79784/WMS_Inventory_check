import { languageSafety } from './safety';
import { persistLanguage, readLanguage, t, type Language } from './index';

// Suppress a second native beforeunload prompt after the user already confirmed a language reload.
let approvedLanguageReload = false;
export function consumeApprovedLanguageReload(): boolean {
  const approved = approvedLanguageReload;
  approvedLanguageReload = false;
  return approved;
}
export interface LanguageSwitchActions {
  ask?: (message: string) => boolean;
  notify?: (message: string) => void;
  reload?: () => void;
}
/** No business API, upload, save or draft mutation is performed by this function. */
export function switchLanguage(next: Language, actions: LanguageSwitchActions = {}): boolean {
  if (next === readLanguage()) return true;
  const state = languageSafety();
  if (state.busy) {
    (actions.notify ?? window.alert)(t('busy'));
    return false;
  }
  if (state.dirty && !(actions.ask ?? window.confirm)(t('unsaved'))) return false;
  if (!persistLanguage(next)) {
    (actions.notify ?? window.alert)(t('storageError'));
    return false;
  }
  if (!actions.reload) approvedLanguageReload = true;
  (actions.reload ?? (() => window.location.reload()))();
  return true;
}
