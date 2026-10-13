import { t } from '../i18n';
import { languageSafety } from '../i18n/safety';

export function confirmPdaExit(
  ask: (message: string) => boolean = window.confirm,
  notify: (message: string) => void = window.alert
): boolean {
  const state = languageSafety();
  if (state.busy) {
    notify(t('exitBusy'));
    return false;
  }
  return ask(t(state.dirty ? 'exitUnsavedConfirm' : 'exitConfirm'));
}
