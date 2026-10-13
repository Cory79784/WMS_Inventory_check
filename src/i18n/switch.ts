import { languageSafety } from './safety';
import { persistLanguage, readLanguage, t, type Language } from './index';

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
  (actions.reload ?? (() => window.location.reload()))();
  return true;
}
