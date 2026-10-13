import { t } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { focusScannerInput, scannerKeyboard } from '../utils/scannerInput';

export const ReturnFields: React.FC<{
  isReturn: boolean;
  returnCode: string;
  onReturnChange: (value: boolean) => void;
  onCodeChange: (value: string) => void;
  disabled?: boolean;
}> = ({ isReturn, returnCode, onReturnChange, onCodeChange, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (isReturn) focusScannerInput(inputRef.current);
    setManual(false);
  }, [isReturn]);
  return (
    <div className="space-y-2 text-xs">
      <label className="flex items-center gap-2 text-slate-700">
        <input type="checkbox" checked={isReturn} disabled={disabled}
          onChange={event => onReturnChange(event.target.checked)} />
        {t('returnGoods')}
      </label>
      {isReturn && (
        <div className="flex items-center gap-2">
          <input ref={inputRef} type="text" dir="ltr" aria-label={t("returnCode")}
            value={returnCode} onChange={event => onCodeChange(event.target.value)}
            inputMode={manual ? 'text' : /Android/i.test(navigator.userAgent) ? undefined : 'none'}
            {...{ virtualkeyboardpolicy: !manual && scannerKeyboard() ? 'manual' : 'auto' }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === 'Tab') event.preventDefault();
            }}
            disabled={disabled} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            placeholder={t("scanReturn")}
            className="w-full min-w-0 font-mono border border-slate-300 rounded-lg p-2" />
          <button type="button" aria-label={t("manualReturn")} disabled={disabled}
            className="text-slate-600 bg-slate-100 p-2 rounded-lg"
            onClick={() => { setManual(true); focusScannerInput(inputRef.current, true); }}>
            <Keyboard className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
