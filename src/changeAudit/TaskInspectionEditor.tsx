import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, PlusCircle, FileQuestion, Camera, Save, RotateCw } from 'lucide-react';
import { InspectionSkuCard } from '../components/InspectionSkuCard';
import { InspectionShortageModal, InspectionSurplusModal } from '../components/InspectionModals';
import { t } from '../i18n';
import { registerLanguageSafety } from '../i18n/safety';
import { focusScannerInput, scannerKeyboard } from '../utils/scannerInput';
import type { LocationSkuItem } from '../types';
import type { AuditResult, AuditLine, Target } from './model';
import type { AuditSession, Upload } from './session';
import { auditId, photoUrl } from './api';
import { canComplete, taskSkuItems } from './inspectionAdapter';
export function TaskInspectionEditor({ session, target, result, disabled }: {
    session: AuditSession;
    target: Target;
    result: AuditResult;
    disabled: boolean;
}) {
    const location = target.location, items = taskSkuItems(target, result);
    const [shortageModalSku, setShortageModalSku] = useState<LocationSkuItem | null>(null), [shortageCountInput, setShortageCountInput] = useState('1');
    const [shortageIsReturn, setShortageIsReturn] = useState(false), [shortageReturnCode, setShortageReturnCode] = useState('');
    const [showSurplusModal, setShowSurplusModal] = useState(false), [surplusMode, setSurplusMode] = useState<'SKU' | 'BARCODE' | 'NO_SKU'>('SKU');
    const [surplusSkuInput, setSurplusSkuInput] = useState(''), [surplusBarcodeInput, setSurplusBarcodeInput] = useState(''), [surplusQtyInput, setSurplusQtyInput] = useState('1'), [surplusNotesInput, setSurplusNotesInput] = useState('');
    const [surplusIsReturn, setSurplusIsReturn] = useState(false), [surplusReturnCode, setSurplusReturnCode] = useState(''), [surplusPhotoFile, setSurplusPhotoFile] = useState<File | null>(null), [surplusPhotoPreview, setSurplusPhotoPreview] = useState<string | null>(null);
    const [uploadingSurplusPhoto, setUploadingSurplusPhoto] = useState(false), [surplusUploadFailed, setSurplusUploadFailed] = useState(false), [manualInput, setManualInput] = useState(false), [message, setMessage] = useState('');
    const [photoTarget, setPhotoTarget] = useState('');
    const surplusSkuRef = useRef<HTMLInputElement>(null), surplusBarcodeRef = useRef<HTMLInputElement>(null), surplusFileInputRef = useRef<HTMLInputElement>(null), photoRef = useRef<HTMLInputElement>(null);
    const pending = session.uploads.filter(u => u.location === location && u.status !== 'saved');
    const photos = session.task.photos.filter(p => p.location === location && !result.ignoredPhotoIds?.includes(p.id));
    const hasBook = target.skus.some(s => s.qty > 0), blocked = disabled || uploadingSurplusPhoto;
    const modalGuard = useRef({ dirty: false, busy: false });
    modalGuard.current = { dirty: !!shortageModalSku || showSurplusModal, busy: uploadingSurplusPhoto };
    useEffect(() => registerLanguageSafety(`change-audit-modal:${session.task.id}:${location}`, { dirty: () => modalGuard.current.dirty, busy: () => modalGuard.current.busy }), [session, location]);
    useEffect(() => { if (showSurplusModal)
        focusScannerInput(surplusMode === 'SKU' ? surplusSkuRef.current : surplusBarcodeRef.current); }, [showSurplusModal, surplusMode]);
    useEffect(() => () => { if (surplusPhotoPreview)
        URL.revokeObjectURL(surplusPhotoPreview); }, [surplusPhotoPreview]);
    useEffect(() => { if (disabled) {
        setShortageModalSku(null);
        setShowSurplusModal(false);
    } }, [disabled]);
    const change = (patch: Partial<AuditResult>, confirmed = false) => {
        const value = { ...session.result(location), ...patch };
        const evidence = value.lines.every(line => line.id.startsWith('book:') || line.sku || line.barcode || !(line.actual || 0) || session.task.photos.some(p => p.location === location && !value.ignoredPhotoIds?.includes(p.id) && (value.photoLines?.[p.id] ?? p.lineId) === line.id));
        value.completed = canComplete(target, value) && evidence && (confirmed || value.completed) && !session.uploads.some(u => u.location === location && u.status !== 'saved');
        session.edit(location, value);
    };
    const normal = (index: number) => {
        const value = session.result(location), line = value.lines[index], qty = target.skus.find(s => `book:${s.sku}` === line.id)?.qty || 0;
        change({ lines: value.lines.map((l, i) => i === index ? { ...l, actual: qty, notes: l.notes === '盘点正常相符' ? '' : l.notes, isReturn: false, returnCode: '' } : l) }, true);
    };
    const openShortage = (item: LocationSkuItem) => { if (item.systemQty <= 0) {
        setMessage(t('invalidShortage'));
        return;
    } setShortageModalSku(item); setShortageCountInput('1'); setShortageIsReturn(!!item.isReturn); setShortageReturnCode(item.returnCode || ''); };
    const submitShortage = () => {
        if (!shortageModalSku || disabled)
            return;
        const count = Number(shortageCountInput);
        if (!Number.isInteger(count) || count <= 0 || count > shortageModalSku.systemQty) {
            setMessage(t('invalidShortage'));
            return;
        }
        change({ lines: session.result(location).lines.map(line => line.id === shortageModalSku.lineId ? { ...line, actual: shortageModalSku.systemQty - count, notes: `现场少货 ${count} 件`, isReturn: shortageIsReturn, returnCode: shortageIsReturn ? shortageReturnCode.trim() : '' } : line) }, true);
        setShortageModalSku(null);
        setMessage('');
    };
    const allNormal = () => {
        if (blocked || pending.length)
            return;
        const current = session.result(location);
        const edited = current.lines.some(l => l.id.startsWith('extra:') || l.actual !== null || l.notes || l.isReturn) || current.notes || photos.length;
        if (edited && !window.confirm(t('auditAllNormalKeepEvidence')))
            return;
        change({ lines: target.skus.map(s => ({ id: `book:${s.sku}`, sku: s.sku, barcode: s.barcode, actual: s.qty, notes: '', isReturn: false, returnCode: '' })), notes: '', emptyConfirmed: false, photoLines: {},
            ignoredPhotoIds: [...new Set([...(current.ignoredPhotoIds || []), ...photos.map(p => p.id)])] }, true);
    };
    const confirmEmpty = () => {
        if (blocked || pending.length)
            return;
        const current = session.result(location);
        if (current.lines.some(l => (l.actual || 0) > 0) && !window.confirm(t('emptyWarning')))
            return;
        const kept = new Set(target.skus.map(s => `book:${s.sku}`));
        const photoLines = Object.fromEntries(session.task.photos.filter(p=>p.location===location).map(p=>{
            const assigned=current.photoLines?.[p.id]??p.lineId;
            return [p.id,kept.has(assigned)?assigned:''];
        }));
        change({ lines: target.skus.map(s => ({ id: `book:${s.sku}`, sku: s.sku, barcode: s.barcode, actual: 0, notes: '', isReturn: false, returnCode: '' })), emptyConfirmed: true, photoLines }, true);
    };
    const validPhoto = (file: File) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024;
    const addPhoto = async (file: File, lineId: string) => {
        if (!validPhoto(file)) {
            setMessage(t('auditPhotoHint'));
            return;
        }
        const upload: Upload = { id: auditId(), location, lineId, file, url: URL.createObjectURL(file), status: 'uploading', error: '' };
        await session.addPhoto(upload);
        return upload;
    };
    const surplusLine = useRef<string | null>(null);
    const submitSurplus = async () => {
        if (disabled)
            return;
        const qty = Number(surplusQtyInput);
        if (!Number.isInteger(qty) || qty < 1) {
            setMessage(t('invalidSurplus'));
            return;
        }
        if (surplusMode === 'SKU' && !surplusSkuInput.trim()) {
            setMessage(t('missingSku'));
            return;
        }
        if (surplusMode === 'BARCODE' && !surplusBarcodeInput.trim()) {
            setMessage(t('missingBarcode'));
            return;
        }
        if (surplusMode === 'NO_SKU' && !surplusPhotoFile) {
            setMessage(t('noSkuPhotoWarning'));
            return;
        }
        if (surplusPhotoFile && !validPhoto(surplusPhotoFile)) {
            setMessage(t('auditPhotoHint'));
            return;
        }
        setUploadingSurplusPhoto(true);
        setSurplusUploadFailed(false);
        try {
            const id = surplusLine.current || `extra:${auditId()}`;
            surplusLine.current = id;
            const line: AuditLine = { id, sku: surplusMode === 'SKU' ? surplusSkuInput.trim() : '', barcode: surplusMode === 'BARCODE' ? surplusBarcodeInput.trim() : '', actual: qty,
                notes: surplusNotesInput.trim() || `现场多货 ${qty} 件 (${surplusMode})`, isReturn: surplusIsReturn, returnCode: surplusIsReturn ? surplusReturnCode.trim() : '' };
            const current = session.result(location);
            const lines = current.lines.some(l => l.id === id) ? current.lines.map(l => l.id === id ? line : l) : [...current.lines, line];
            change({ lines, emptyConfirmed: false, completed: false }, !surplusPhotoFile);
            await session.flush(location);
            if (surplusPhotoFile) {
                const old = session.uploads.find(u => u.location === location && u.lineId === id && u.status !== 'saved');
                const upload = old ? (await session.addPhoto(old), old) : await addPhoto(surplusPhotoFile, id);
                if (upload?.status !== 'saved')
                    throw new Error(t('auditUploadFailed'));
            }
            if (!session.result(location).completed && canComplete(target, session.result(location)))
                change({}, true);
            setShowSurplusModal(false);
            setSurplusSkuInput('');
            setSurplusBarcodeInput('');
            setSurplusQtyInput('1');
            setSurplusNotesInput('');
            setSurplusIsReturn(false);
            setSurplusReturnCode('');
            setSurplusPhotoFile(null);
            setSurplusPhotoPreview(null);
            surplusLine.current = null;
            setMessage('');
        }
        catch (e) {
            setSurplusUploadFailed(true);
            setMessage((e as Error).message);
        }
        finally {
            setUploadingSurplusPhoto(false);
        }
    };
    const renderCard = (item: LocationSkuItem) => {
        const index = items.findIndex(s => s.lineId === item.lineId), book = target.skus.find(s => `book:${s.sku}` === item.lineId);
        return <div key={item.lineId}><InspectionSkuCard item={item} idx={index} handleSetSkuNormal={normal} handleOpenShortage={openShortage} emphasizeBook bookLabel={t(session.task.stale ? 'auditReferenceBook' : 'auditCurrentBook')} unknownAllocation={!!book && book.availableQty === undefined}/>
   <details className="px-3 py-1 text-xs text-slate-500"><summary>{t('notes')}</summary><input aria-label={`${t('notes')} ${item.sku}`} value={item.notes || ''} maxLength={1000} onChange={e => change({ lines: session.result(location).lines.map(l => l.id === item.lineId ? { ...l, notes: e.target.value } : l) })} className="w-full border rounded-lg px-3 py-2 mt-1"/></details>
  </div>;
    };
    const currentItems = items.filter(i => i.systemQty > 0 || i.lineId?.startsWith('extra:')), residual = items.filter(i => i.systemQty === 0 && i.lineId?.startsWith('book:'));
    return <div className="space-y-2.5">
  {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
  <fieldset disabled={blocked} className="space-y-2.5">
   <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
    <div className="flex items-center justify-between"><div><span className="text-[11px] text-slate-400 font-medium">{t('currentPhysical')}</span><h2 className="text-2xl font-bold font-mono text-slate-900 tracking-tight flex items-center gap-2">{location}{result.emptyConfirmed && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-normal font-sans border border-slate-200">{t('emptyConfirm')}</span>}</h2></div>
    {hasBook && !result.emptyConfirmed && <button type="button" onClick={allNormal} disabled={pending.length > 0} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm active:scale-95 transition"><CheckCircle2 className="w-4 h-4 text-emerald-600"/>{t('allNormal')}</button>}</div>
    {!hasBook && <div className="mt-2 bg-amber-50 border border-amber-200 p-2.5 rounded-lg flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-amber-800"><FileQuestion className="w-4 h-4 text-amber-600"/><span>{t('wmsEmpty')}</span></div><button type="button" onClick={confirmEmpty} disabled={pending.length > 0} className={`text-xs font-medium px-2.5 py-1 rounded transition ${result.emptyConfirmed ? 'bg-emerald-600 text-white' : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'}`}>{result.emptyConfirmed ? t('emptyConfirmed') : t('emptyConfirm')}</button></div>}
   </div>
   <div className="space-y-2.5"><div className="flex items-center justify-between px-1"><span className="text-xs font-bold text-slate-700">{t('locationCountTitle')} ({currentItems.length} {t('pieceCount')} SKU)</span><button type="button" onClick={() => { setManualInput(false); surplusLine.current = null; setSurplusUploadFailed(false); setShowSurplusModal(true); }} className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 active:scale-95 transition"><PlusCircle className="w-3.5 h-3.5"/>{t('surplusAdd')}</button></div>{currentItems.map(renderCard)}</div>
   {residual.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">{t('auditResidual')} ({residual.length})</summary><div className="space-y-2.5">{residual.map(renderCard)}</div></details>}
   <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 space-y-2"><label className="block text-xs font-semibold text-slate-700">{t('locationRemarkLabel')}</label><textarea aria-label={t('notes')} rows={2} value={result.notes} maxLength={2000} onChange={e => change({ notes: e.target.value })} placeholder={t('locationRemarkPlaceholder')} className="w-full min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 resize-y"/></div>
   <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Camera className="w-4 h-4 text-blue-600"/>{t('photoCountTitle')} ({photos.length} {t('photoCountUnit')})</span><button type="button" onClick={() => photoRef.current?.click()} className="text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 px-2.5 py-1 rounded font-medium flex items-center gap-1">{t('photoAdd')}</button><input ref={photoRef} aria-label={t('photo')} type="file" multiple accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={e => { for (const file of Array.from(e.target.files || []))
        void addPhoto(file, photoTarget); e.target.value = ''; }}/></div>
    <label className="block text-xs text-slate-600">{t('photoAssign')}<select aria-label={t('photoTarget')} value={photoTarget} onChange={e => setPhotoTarget(e.target.value)} className="ml-2 border border-slate-300 rounded px-2 py-1 bg-white max-w-full"><option value="">{t('wholeLocation')}</option>{items.map((item, i) => <option key={item.lineId} value={item.lineId}>{item.sku} · #{i + 1}</option>)}</select></label>
    <div className="flex items-center gap-2 overflow-x-auto py-1">{photos.map(photo => {
            const assigned = result.photoLines?.[photo.id] ?? photo.lineId;
            return <div key={photo.id} className="shrink-0 space-y-1"><a href={photoUrl(session.task.hall, session.task.id, photo.id)} target="_blank" rel="noreferrer"><img src={photoUrl(session.task.hall, session.task.id, photo.id)} alt={t('photo')} className="w-16 h-16 object-cover rounded-lg border border-slate-200"/></a>
      <select aria-label={`${t('photoTarget')} ${photo.id}`} value={assigned} onChange={e => change({ photoLines: { ...session.result(location).photoLines, [photo.id]: e.target.value } }, true)} className="block max-w-40 text-xs border border-slate-300 rounded px-1 py-1 bg-white"><option value="">{t('wholeLocation')}</option>{items.map((item, i) => <option key={item.lineId} value={item.lineId}>{item.sku} · #{i + 1}</option>)}</select>
     </div>;
        })}</div>
    {pending.map(upload => <div key={upload.id} className="text-xs text-slate-600 flex gap-2 items-center"><img src={upload.url} alt={t('photo')} className="w-12 h-12 rounded object-cover"/><span>{t(upload.status === 'uploading' ? 'auditUploading' : 'auditUploadFailed')}</span>{upload.status === 'failed' && <button type="button" onClick={async () => { await session.addPhoto(upload); if (upload.status === 'saved')
        change({}, true); }} className="text-blue-600">{t('retry')}</button>}</div>)}
   </div>
   <button type="button" disabled={pending.length > 0} onClick={() => void session.flush(location)} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center gap-2 disabled:opacity-50">{session.drafts.get(location)?.saving ? <RotateCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}{session.drafts.get(location)?.saving ? t('savingNow') : t('saveLocation')}</button>
  </fieldset>
  {shortageModalSku && !disabled && <InspectionShortageModal shortageModalSku={shortageModalSku} setShortageModalSku={setShortageModalSku} shortageCountInput={shortageCountInput} setShortageCountInput={setShortageCountInput} shortageIsReturn={shortageIsReturn} setShortageIsReturn={setShortageIsReturn} shortageReturnCode={shortageReturnCode} setShortageReturnCode={setShortageReturnCode} handleSubmitShortage={submitShortage} buttonsOnly/>}
  {showSurplusModal && !disabled && <InspectionSurplusModal surplusMode={surplusMode} setSurplusMode={setSurplusMode} surplusSkuInput={surplusSkuInput} setSurplusSkuInput={setSurplusSkuInput} surplusBarcodeInput={surplusBarcodeInput} setSurplusBarcodeInput={setSurplusBarcodeInput} surplusQtyInput={surplusQtyInput} setSurplusQtyInput={setSurplusQtyInput} surplusNotesInput={surplusNotesInput} setSurplusNotesInput={setSurplusNotesInput} surplusIsReturn={surplusIsReturn} setSurplusIsReturn={setSurplusIsReturn} surplusReturnCode={surplusReturnCode} setSurplusReturnCode={setSurplusReturnCode} surplusPhotoFile={surplusPhotoFile} surplusPhotoPreview={surplusPhotoPreview} handleSurplusPhotoChange={file => { setSurplusPhotoFile(file); setSurplusPhotoPreview(URL.createObjectURL(file)); }} uploadingSurplusPhoto={uploadingSurplusPhoto} surplusProgress={uploadingSurplusPhoto ? 0 : 100} surplusUploadFailed={surplusUploadFailed} setShowSurplusModal={setShowSurplusModal} handleSubmitSurplus={() => void submitSurplus()} manualInput={manualInput} setManualInput={setManualInput} virtualKeyboard={scannerKeyboard()} surplusSkuRef={surplusSkuRef} surplusBarcodeRef={surplusBarcodeRef} surplusFileInputRef={surplusFileInputRef} buttonsOnly/>}
 </div>;
}
