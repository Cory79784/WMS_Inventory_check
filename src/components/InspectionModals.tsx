import type { RefObject } from 'react';
import { AlertTriangle, X, PlusCircle, Camera, Keyboard } from 'lucide-react';
import { t } from '../i18n';
import type { LocationSkuItem } from '../types';
import { ReturnFields } from './ReturnFields';
import { focusScannerInput } from '../utils/scannerInput';
export function InspectionQuantityButtons({ value, onChange, max = 1000000000, label }: {
    value: string;
    onChange: (value: string) => void;
    max?: number;
    label: string;
}) {
    const number = Math.max(1, parseInt(value || '1', 10) || 1);
    return <div className="flex items-center justify-center gap-2" role="group" aria-label={label}>
  <button type="button" aria-label={t('auditQtyMinus')} disabled={number <= 1} className="rounded-lg border px-4 py-2 text-lg disabled:opacity-40" onClick={() => onChange(String(Math.max(1, number - 1)))}>−</button>
  <output className="text-center text-2xl font-bold font-mono min-w-16" aria-label={label}>{number}</output>
  <button type="button" aria-label={t('auditQtyPlus')} disabled={number >= max} className="rounded-lg border px-4 py-2 text-lg disabled:opacity-40" onClick={() => onChange(String(Math.min(max, number + 1)))}>+</button>
  <button type="button" disabled={number >= max} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => onChange(String(Math.min(max, number + 10)))}>+10</button>
 </div>;
}
export function InspectionShortageModal({ shortageModalSku, setShortageModalSku, shortageCountInput, setShortageCountInput, shortageIsReturn, setShortageIsReturn, shortageReturnCode, setShortageReturnCode, handleSubmitShortage, buttonsOnly = false }: {
    shortageModalSku: LocationSkuItem;
    setShortageModalSku: (item: LocationSkuItem | null) => void;
    shortageCountInput: string;
    setShortageCountInput: (value: string) => void;
    shortageIsReturn: boolean;
    setShortageIsReturn: (value: boolean) => void;
    shortageReturnCode: string;
    setShortageReturnCode: (value: string) => void;
    handleSubmitShortage: () => void;
    buttonsOnly?: boolean;
    photoRequired?: boolean;
}) {
    return (<div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-red-500"/>
                {t('reportShortage')}
              </h3>
              <button type="button" onClick={() => setShortageModalSku(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5"/>
              </button>
            </div>

            <div className="bg-slate-50 p-2.5 rounded-lg text-xs space-y-1">
              <div><strong>SKU:</strong> <span className="font-mono">{shortageModalSku.sku}</span></div>
              <div><strong>{t('productName')}</strong> {shortageModalSku.nameZh}</div>
              <div><strong>{t('bookQty')}</strong> <span className="font-bold text-slate-800 font-mono text-sm">{shortageModalSku.systemQty}</span>{t('pieces')}</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t('shortageQuantity')}
              </label>
              {buttonsOnly ? <InspectionQuantityButtons value={shortageCountInput} onChange={setShortageCountInput} max={shortageModalSku.systemQty} label={t('shortageQuantity')}/> : (<input type="number" dir="ltr" min="1" max={shortageModalSku.systemQty} value={shortageCountInput} onChange={(e) => setShortageCountInput(e.target.value)} placeholder="2" className="w-full text-center text-2xl font-bold font-mono border-2 border-red-300 rounded-lg p-2 focus:outline-none focus:border-red-500" autoFocus/>)}
              <div className="text-right text-xs text-slate-500 mt-1">
                {t('confirmedActual')} {Math.max(0, shortageModalSku.systemQty - (parseInt(shortageCountInput || '0', 10)))} {t('pieces')}
              </div>
            </div>

            <ReturnFields isReturn={shortageIsReturn} returnCode={shortageReturnCode} onReturnChange={value => { setShortageIsReturn(value); if (!value)
        setShortageReturnCode(''); }} onCodeChange={setShortageReturnCode}/>

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShortageModalSku(null)} className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium">
                {t('cancel')}
              </button>
              <button type="button" onClick={handleSubmitShortage} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-bold shadow-md hover:bg-red-700">
                {t('confirmShortage')}
              </button>
            </div>
          </div>
        </div>);
}
export function InspectionSurplusModal({ surplusMode, setSurplusMode, surplusSkuInput, setSurplusSkuInput, surplusBarcodeInput, setSurplusBarcodeInput, surplusQtyInput, setSurplusQtyInput, surplusNotesInput, setSurplusNotesInput, surplusIsReturn, setSurplusIsReturn, surplusReturnCode, setSurplusReturnCode, surplusPhotoFile, surplusPhotoPreview, handleSurplusPhotoChange, uploadingSurplusPhoto, surplusProgress, surplusUploadFailed, setShowSurplusModal, handleSubmitSurplus, manualInput, setManualInput, virtualKeyboard, surplusSkuRef, surplusBarcodeRef, surplusFileInputRef, buttonsOnly = false, photoRequired = surplusMode === 'NO_SKU' }: {
    surplusMode: 'SKU' | 'BARCODE' | 'NO_SKU';
    setSurplusMode: (value: 'SKU' | 'BARCODE' | 'NO_SKU') => void;
    surplusSkuInput: string;
    setSurplusSkuInput: (value: string) => void;
    surplusBarcodeInput: string;
    setSurplusBarcodeInput: (value: string) => void;
    surplusQtyInput: string;
    setSurplusQtyInput: (value: string) => void;
    surplusNotesInput: string;
    setSurplusNotesInput: (value: string) => void;
    surplusIsReturn: boolean;
    setSurplusIsReturn: (value: boolean) => void;
    surplusReturnCode: string;
    setSurplusReturnCode: (value: string) => void;
    surplusPhotoFile: File | null;
    surplusPhotoPreview: string | null;
    handleSurplusPhotoChange: (file: File) => void;
    uploadingSurplusPhoto: boolean;
    surplusProgress: number;
    surplusUploadFailed: boolean;
    setShowSurplusModal: (value: boolean) => void;
    handleSubmitSurplus: () => void;
    manualInput: boolean;
    setManualInput: (value: boolean) => void;
    virtualKeyboard: unknown;
    surplusSkuRef: RefObject<HTMLInputElement>;
    surplusBarcodeRef: RefObject<HTMLInputElement>;
    surplusFileInputRef: RefObject<HTMLInputElement>;
    buttonsOnly?: boolean;
    photoRequired?: boolean;
}) {
    return (<div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                <PlusCircle className="w-5 h-5 text-amber-500"/>
                {t('addSurplusTitle')}
              </h3>
              <button type="button" disabled={uploadingSurplusPhoto} onClick={() => setShowSurplusModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5"/>
              </button>
            </div>

            {/* Mode Selector Pill */}
            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              <button type="button" onClick={() => setSurplusMode('SKU')} className={`py-1.5 rounded font-medium transition ${surplusMode === 'SKU' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {t('scanSku')}
              </button>
              <button type="button" onClick={() => setSurplusMode('BARCODE')} className={`py-1.5 rounded font-medium transition ${surplusMode === 'BARCODE' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {t('scanBarcode')}
              </button>
              <button type="button" onClick={() => setSurplusMode('NO_SKU')} className={`py-1.5 rounded font-medium transition ${surplusMode === 'NO_SKU' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-500'}`}>
                {t('noSku')}
              </button>
            </div>

            {/* Field: SKU code */}
            {surplusMode === 'SKU' && (<div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('skuInputLabel')}
                </label>
                <input ref={surplusSkuRef} type="text" inputMode={manualInput ? 'text' : 'none'} {...{ virtualkeyboardpolicy: !manualInput && virtualKeyboard ? 'manual' : 'auto' }} value={surplusSkuInput} onChange={(e) => setSurplusSkuInput(e.target.value.toUpperCase())} placeholder={t('skuPlaceholder')} className="w-full font-mono font-bold text-sm border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}/>
                <button type="button" aria-label={t('manual')} onClick={(event) => {
                const input = event.currentTarget.previousElementSibling as HTMLInputElement;
                setManualInput(!manualInput);
                if (manualInput)
                    input.blur();
                focusScannerInput(input, !manualInput);
            }} className="mt-1 text-slate-600"><Keyboard className="w-4 h-4"/></button>
              </div>)}

            {/* Field: Barcode */}
            {surplusMode === 'BARCODE' && (<div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('barcodeInputLabel')}
                </label>
                <input ref={surplusBarcodeRef} type="text" inputMode={manualInput ? 'text' : 'none'} {...{ virtualkeyboardpolicy: !manualInput && virtualKeyboard ? 'manual' : 'auto' }} value={surplusBarcodeInput} onChange={(e) => setSurplusBarcodeInput(e.target.value.trim())} placeholder={t('barcodePlaceholder')} className="w-full font-mono font-bold text-sm border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}/>
                <button type="button" aria-label={t('manual')} onClick={(event) => {
                const input = event.currentTarget.previousElementSibling as HTMLInputElement;
                setManualInput(!manualInput);
                if (manualInput)
                    input.blur();
                focusScannerInput(input, !manualInput);
            }} className="mt-1 text-slate-600"><Keyboard className="w-4 h-4"/></button>
              </div>)}

            {/* Field: No SKU rule notice */}
            {surplusMode === 'NO_SKU' && (<div className="bg-amber-50 border border-amber-200 p-2 rounded-lg text-xs text-amber-800">
                <strong>{t('mandatory')}</strong> {t('noSkuExplanation')}
              </div>)}

            {/* Field: Quantity */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t('surplusQty')}
              </label>
              {buttonsOnly ? <InspectionQuantityButtons value={surplusQtyInput} onChange={setSurplusQtyInput} label={t('surplusQty')}/> : (<input type="number" min="1" value={surplusQtyInput} onChange={(e) => setSurplusQtyInput(e.target.value)} placeholder={t('qtyPlaceholder')} className="w-full text-center text-xl font-bold font-mono border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"/>)}
            </div>

            {/* Field: Photo Upload (Mandatory for NO_SKU) */}
            <ReturnFields isReturn={surplusIsReturn} returnCode={surplusReturnCode} onReturnChange={value => { setSurplusIsReturn(value); if (!value)
        setSurplusReturnCode(''); }} onCodeChange={setSurplusReturnCode} disabled={uploadingSurplusPhoto}/>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {photoRequired ? (<span className="text-red-600 font-bold">{t('photoRequired')}</span>) : (t('photoOptional'))}
              </label>
              <input ref={surplusFileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
            if (e.target.files?.[0]) {
                handleSurplusPhotoChange(e.target.files[0]);
            }
        }}/>

              <div className="flex items-center gap-2">
                <button type="button" onClick={() => surplusFileInputRef.current?.click()} className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 border border-slate-200">
                  <Camera className="w-4 h-4 text-blue-600"/>
                  {surplusPhotoFile ? t('rePhoto') : t('camera')}
                </button>

                {surplusPhotoPreview && (<div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-300 shrink-0">
                    <img src={surplusPhotoPreview} alt="Preview" className="w-full h-full object-cover"/>
                  </div>)}
              </div>
            </div>

            {/* Field: Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t('notesOptional')}
              </label>
              <input type="text" value={surplusNotesInput} onChange={(e) => setSurplusNotesInput(e.target.value)} placeholder={t('notesExample')} className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
            </div>

            {uploadingSurplusPhoto && surplusPhotoFile && <progress aria-label={t('uploadQuantityLabel')} max={100} value={surplusProgress} className="w-full h-2"/>}
            <div className="flex gap-2 pt-2">
              <button type="button" disabled={uploadingSurplusPhoto} onClick={() => setShowSurplusModal(false)} className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium">
                {t('cancel')}
              </button>
              <button type="button" disabled={uploadingSurplusPhoto} onClick={handleSubmitSurplus} className="flex-1 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold shadow-md hover:bg-amber-700 disabled:opacity-50">
                {uploadingSurplusPhoto ? `${t('photoUploading')} ${surplusProgress}%` : surplusUploadFailed ? t('retry') : t('surplusConfirm')}
              </button>
            </div>
          </div>
        </div>);
}
