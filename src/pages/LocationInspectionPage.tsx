import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n';
import { registerLanguageSafety } from '../i18n/safety';
import { ReturnFields } from '../components/ReturnFields';
import { focusScannerInput, scannerKeyboard } from '../utils/scannerInput';
import { HallId, LocationAuditData, LocationSkuItem, InspectionPhotoItem } from '../types';
import {
  fetchLocationAudit,
  saveLocationInspection,
  uploadInspectionPhoto,
  fetchActiveVersion,
} from '../services/api';
import {
  Scan,
  CheckCircle2,
  AlertTriangle,
  Camera,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  RotateCw,
  X,
  FileQuestion,
  Save,
  Check,
  Keyboard,
} from 'lucide-react';

interface PhotoUpload {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'saved' | 'error';
  sku?: string;
}
interface LocationDraft {
  data: LocationAuditData;
  skus: LocationSkuItem[];
  photos: InspectionPhotoItem[];
  notes: string;
  empty: boolean;
  uploads: PhotoUpload[];
}
// Page-session drafts only: no persistence, offline queue or background processing.
const locationDrafts = new Map<string, LocationDraft>();
export const hasUnsavedInspectionDrafts = () => [...locationDrafts.values()].some(hasDraftChanges);
const locationKey = (hall: string, code: string, version: string) => `${hall}:${code.toUpperCase()}:${version}`;
const hasDraftChanges = (draft: LocationDraft) =>
  JSON.stringify(draft.skus) !== JSON.stringify(draft.data.skus) ||
  JSON.stringify(draft.photos) !== JSON.stringify(draft.data.inspection?.photos || []) ||
  draft.notes !== (draft.data.inspection?.notes || '') ||
  draft.empty !== Boolean(draft.data.inspection?.isEmptyConfirmed) ||
  draft.uploads.some((upload) => upload.status !== 'saved');

interface LocationInspectionPageProps {
  currentHall: HallId;
  onOpenImport: () => void;
  onOpenTest: () => void;
}

export const LocationInspectionPage: React.FC<LocationInspectionPageProps> = ({
  currentHall,
  onOpenImport,
  onOpenTest,
}) => {
  // Input search state
  const [inputLoc, setInputLoc] = useState('');
  const [manualInput, setManualInput] = useState(false);
  // Android scanner services may inject text through the IME; match DeviceTestPage.
  const androidScanner = /Android/i.test(navigator.userAgent);
  const [uploads, setUploads] = useState<PhotoUpload[]>([]);
  const [surplusProgress, setSurplusProgress] = useState(0);
  const [surplusUploadFailed, setSurplusUploadFailed] = useState(false);
  const requestId = useRef(0);
  const uploadsInFlight = useRef(0);
  const activeKey = useRef<string | null>(null);
  const [activeVersionInfo, setActiveVersionInfo] = useState<any | null>(null);

  // Current location audit state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locData, setLocData] = useState<LocationAuditData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Editable inspection state for current location
  const [skuList, setSkuList] = useState<LocationSkuItem[]>([]);
  const [photos, setPhotos] = useState<InspectionPhotoItem[]>([]);
  const [photoTargetSku, setPhotoTargetSku] = useState('');
  const [locationNotes, setLocationNotes] = useState('');
  const [isEmptyConfirmed, setIsEmptyConfirmed] = useState(false);

  // Modal: Shortage Input
  const [shortageModalSku, setShortageModalSku] = useState<LocationSkuItem | null>(null);
  const [shortageCountInput, setShortageCountInput] = useState<string>('');
  const [shortageIsReturn, setShortageIsReturn] = useState(false);
  const [shortageReturnCode, setShortageReturnCode] = useState('');

  // Modal: Surplus Input
  const [showSurplusModal, setShowSurplusModal] = useState(false);
  const [surplusMode, setSurplusMode] = useState<'SKU' | 'BARCODE' | 'NO_SKU'>('SKU');
  const [surplusSkuInput, setSurplusSkuInput] = useState('');
  const [surplusBarcodeInput, setSurplusBarcodeInput] = useState('');
  const [surplusQtyInput, setSurplusQtyInput] = useState('1');
  const [surplusNotesInput, setSurplusNotesInput] = useState('');
  const [surplusIsReturn, setSurplusIsReturn] = useState(false);
  const [surplusReturnCode, setSurplusReturnCode] = useState('');
  const [surplusPhotoFile, setSurplusPhotoFile] = useState<File | null>(null);
  const [surplusPhotoPreview, setSurplusPhotoPreview] = useState<string | null>(null);
  const [uploadingSurplusPhoto, setUploadingSurplusPhoto] = useState(false);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const virtualKeyboard = scannerKeyboard();
  const focusScanner = (manual = false) => {
    focusScannerInput(scanInputRef.current, manual);
    if (!manual && !androidScanner) scanInputRef.current?.select();
  };
  const keepScannerFocus = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (androidScanner && !manualInput) event.preventDefault();
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const surplusFileInputRef = useRef<HTMLInputElement>(null);
  const surplusSkuRef = useRef<HTMLInputElement>(null);
  const surplusBarcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortageModalSku && !showSurplusModal) {
      setManualInput(false);
      focusScanner();
    }
  }, [shortageModalSku, showSurplusModal]);
  useEffect(() => {
    if (showSurplusModal) {
      setManualInput(false);
      focusScannerInput(surplusMode === 'SKU' ? surplusSkuRef.current : surplusBarcodeRef.current);
    }
  }, [showSurplusModal, surplusMode]);

  activeKey.current = locData ? locationKey(locData.hallId, locData.locationCode, locData.referenceImportId) : null;
  const photoBusy = uploads.some((upload) => upload.status === 'uploading');
  const photoFailed = uploads.some((upload) => upload.status === 'error');
  useEffect(() => {
    if (locData) locationDrafts.set(locationKey(locData.hallId, locData.locationCode, locData.referenceImportId), {
      data: locData, skus: skuList, photos, notes: locationNotes, empty: isEmptyConfirmed, uploads,
    });
  }, [locData, skuList, photos, locationNotes, isEmptyConfirmed, uploads]);

  // Language switching is blocked while any location is saving/uploading.
  // The latest state is read from a ref to avoid remounting scanner listeners.
  const languageGuardRef = useRef({dirty: false, busy: false});
  languageGuardRef.current = {
    dirty: [...locationDrafts.values()].some(hasDraftChanges) ||
      Boolean(locData && (JSON.stringify(skuList) !== JSON.stringify(locData.skus) ||
        JSON.stringify(photos) !== JSON.stringify(locData.inspection?.photos || []) ||
        locationNotes !== (locData.inspection?.notes || '') ||
        isEmptyConfirmed !== Boolean(locData.inspection?.isEmptyConfirmed))) ||
      Boolean(shortageModalSku || showSurplusModal || surplusPhotoFile || surplusNotesInput || surplusSkuInput || surplusBarcodeInput),
    busy: saving || loading || photoBusy || uploadingSurplusPhoto || uploadsInFlight.current > 0 || photoFailed,
  };
  useEffect(() => registerLanguageSafety('inspection', {
    dirty: () => languageGuardRef.current.dirty,
    busy: () => languageGuardRef.current.busy,
  }), []);

  // Haptic feedback for PDA
  const triggerHaptic = (success = true) => {
    if (navigator.vibrate) {
      navigator.vibrate(success ? [40] : [80, 50, 80]);
    }
  };

  // Load Active Version for current Hall
  const loadActiveVersion = async () => {
    setErrorMsg(null);
    try {
      const res = await fetchActiveVersion(currentHall);
      if (res.hasActiveVersion) {
        setActiveVersionInfo(res.activeVersion);
      } else {
        setActiveVersionInfo(null);
      }
    } catch (err: unknown) {
      console.error('Failed to load active version', err);
    }
  };

  useEffect(() => {
    requestId.current++;
    loadActiveVersion();
    setManualInput(false);
    setLoading(false);
    setLocData(null);
    setInputLoc('');
    setSkuList([]);
    setPhotos([]);
    setUploads([]);
    setLocationNotes('');
    setIsEmptyConfirmed(false);
    focusScanner();
  }, [currentHall]);

  // Load Location Audit
  const handleQueryLocation = async (targetLoc: string) => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
    const loc = targetLoc.trim();
    if (!loc) return;
    if (saving || photoBusy || uploadsInFlight.current || uploadingSurplusPhoto) {
      setErrorMsg(t('scanBusy'));
      return;
    }
    const id = ++requestId.current;
    if (androidScanner && manualInput && !virtualKeyboard) scanInputRef.current?.blur();
    setManualInput(false);
    if (locData) locationDrafts.set(locationKey(locData.hallId, locData.locationCode, locData.referenceImportId), {
      data: locData, skus: skuList, photos, notes: locationNotes, empty: isEmptyConfirmed, uploads,
    });
    setLoading(true);
    setErrorMsg(null);
    setSaveSuccessMsg(null);

    try {
      const freshData = await fetchLocationAudit(currentHall, loc);
      const cachedDraft = locationDrafts.get(locationKey(currentHall, loc, freshData.referenceImportId));
      const draft = cachedDraft && hasDraftChanges(cachedDraft) ? cachedDraft : undefined;
      const data = draft?.data || freshData;
      if (id !== requestId.current) return;
      setLocData(data);
      setInputLoc(androidScanner ? '' : data.locationCode);

      // Initialize SKU inspection state
      const initializedSkus: LocationSkuItem[] = data.skus.map((s: LocationSkuItem) => ({
        ...s,
        actualQty: s.actualQty !== null && s.actualQty !== undefined ? s.actualQty : null,
        differenceQty: s.differenceQty !== null && s.differenceQty !== undefined ? s.differenceQty : null,
        discrepancyType: s.discrepancyType || null,
      }));

      setSkuList(draft?.skus || initializedSkus);
      setPhotos(draft?.photos || data.inspection?.photos || []);
      setUploads(draft?.uploads || []);
      setLocationNotes(draft?.notes ?? data.inspection?.notes ?? '');
      setIsEmptyConfirmed(draft?.empty ?? Boolean(data.inspection?.isEmptyConfirmed));

      triggerHaptic(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (id !== requestId.current) return;
      setErrorMsg(msg);
      triggerHaptic(false);
    } finally {
      if (id !== requestId.current) return;
      setLoading(false);
      // Re-focus scanner input
      setTimeout(() => {
        focusScanner();
      }, 0);
    }
  };

  // Handle Scanner Enter Key
  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleQueryLocation(e.currentTarget.value);
    }
  };

  // Keyboard-wedge scanners can start while a previous action button has focus.
  useEffect(() => {
    const captureScan = (event: KeyboardEvent) => {
      if (manualInput || shortageModalSku || showSurplusModal || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || event.key.length !== 1 || event.key === ' ') return;
      event.preventDefault();
      const input = scanInputRef.current;
      if (!input) return;
      focusScannerInput(input);
      input.value = event.key.toUpperCase();
      setInputLoc(input.value);
      input.setSelectionRange(input.value.length, input.value.length);
    };
    document.addEventListener('keydown', captureScan);
    return () => document.removeEventListener('keydown', captureScan);
  }, [manualInput, shortageModalSku, showSurplusModal]);

  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current); }, []);
  useEffect(() => {
    if (!saveSuccessMsg) return;
    const timer = setTimeout(() => setSaveSuccessMsg(null), 900);
    return () => clearTimeout(timer);
  }, [saveSuccessMsg]);

  const handleScanChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value.toUpperCase();
    setInputLoc(value);
    if (scanTimer.current) clearTimeout(scanTimer.current);
    // Support scanner configurations without an Enter/Tab suffix; manual typing stays explicit.
    if (!manualInput && /^\d{3}-\d{3}-\d{1,2}$/.test(value)) {
      scanTimer.current = setTimeout(() => handleQueryLocation(value), 150);
    }
  };

  // Vertical navigation changes only the first numeric segment.
  const verticalLocation = (offset: -1 | 1): string | null => {
    if (!locData) return null;
    const match = /^(\d+)-(\d+)-(\d+)$/.exec(locData.locationCode);
    if (!match) return null;
    const first = Number(match[1]) + offset;
    if (!Number.isSafeInteger(first) || first < 1 || String(first).length > match[1].length) return null;
    return `${String(first).padStart(match[1].length, '0')}-${match[2]}-${match[3]}`;
  };

  // 1-Tap Normal for single SKU
  const handleSetSkuNormal = (skuIndex: number) => {
    setSkuList((prev) =>
      prev.map((item, index) => {
        if (index === skuIndex) {
          return {
            ...item,
            actualQty: item.systemQty,
            differenceQty: 0,
            discrepancyType: 'NORMAL',
            notes: '盘点正常相符',
            isReturn: false,
            returnCode: '',
          };
        }
        return item;
      })
    );
    triggerHaptic(true);
  };

  // If nothing has been recorded, this remains a one-tap action.
  // Otherwise confirm before discarding current anomalies, notes and photo links.
  const handleSetAllNormal = async () => {
    if (!locData || saving || loading || photoBusy || photoFailed || uploadingSurplusPhoto) return;
    const hasEdits = skuList.some(item =>
      item.systemQty === 0 ||
      (item.discrepancyType !== null && item.discrepancyType !== 'NORMAL') ||
      Boolean(item.differenceQty) || Boolean(item.notes?.trim()) ||
      Boolean(item.isReturn) || Boolean(item.returnCode?.trim())
    ) || Boolean(locationNotes.trim()) || photos.length > 0 || isEmptyConfirmed ||
      Boolean(locData.inspection?.isEmptyConfirmed);
    if (hasEdits && !confirm(t('allNormalConfirm'))) return;

    // Only original WMS stock rows are retained; manually added surplus rows are discarded.
    const normalSkus = skuList.filter(item => item.systemQty > 0).map(item => ({
      ...item, actualQty: item.systemQty, differenceQty: 0,
      discrepancyType: 'NORMAL' as const, notes: '',
      isReturn: false, returnCode: '',
    }));
    await handleSaveInspection(normalSkus, false, '', [], true);
  };

  // Confirm Empty Location
  const handleConfirmEmpty = async () => {
    if (saving || loading || photoBusy || photoFailed || uploadingSurplusPhoto) return;
    if (skuList.length && !confirm(t('emptyWarning'))) return;
    await handleSaveInspection([], true);
  };

  // Open Shortage Modal
  const handleOpenShortage = (item: LocationSkuItem) => {
    setShortageModalSku(item);
    setShortageCountInput('1');
    setShortageIsReturn(Boolean(item.isReturn));
    setShortageReturnCode(item.returnCode || '');
  };

  // Submit Shortage
  const handleSubmitShortage = () => {
    if (!shortageModalSku) return;
    const shortageCount = parseInt(shortageCountInput || '0', 10);
    if (isNaN(shortageCount) || shortageCount <= 0) {
      alert(t('invalidShortage'));
      return;
    }

    if (shortageCount > shortageModalSku.systemQty) {
      alert(`少货数量 (${shortageCount}) 不能大于账面库存 (${shortageModalSku.systemQty})！`);
      return;
    }

    const actual = shortageModalSku.systemQty - shortageCount;
    const diff = -shortageCount;

    setSkuList((prev) =>
      prev.map((item) => {
        if (item === shortageModalSku) {
          return {
            ...item,
            actualQty: actual,
            differenceQty: diff,
            discrepancyType: 'SHORTAGE',
            notes: `现场少货 ${shortageCount} 件`,
            isReturn: shortageIsReturn,
            returnCode: shortageIsReturn ? shortageReturnCode.trim() : '',
          };
        }
        return item;
      })
    );

    setShortageModalSku(null);
    setShortageCountInput('');
    triggerHaptic(true);
  };

  // Handle Photo File selection for Surplus
  const handleSurplusPhotoChange = (file: File) => {
    setSurplusPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setSurplusPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Submit Surplus
  const handleSubmitSurplus = async () => {
    const qty = parseInt(surplusQtyInput || '0', 10);
    if (isNaN(qty) || qty <= 0) {
      alert(t('invalidSurplus'));
      return;
    }

    if (surplusMode === 'SKU' && !surplusSkuInput.trim()) {
      alert(t('missingSku'));
      return;
    }

    if (surplusMode === 'BARCODE' && !surplusBarcodeInput.trim()) {
      alert(t('missingBarcode'));
      return;
    }

    if (surplusMode === 'NO_SKU') {
      if (!surplusPhotoFile) {
        alert(t('noSkuPhotoWarning'));
        return;
      }
    }

    setUploadingSurplusPhoto(true);
    setSurplusProgress(0);
    setSurplusUploadFailed(false);

    try {
      let uploadedPhotoInfo: any = null;
      if (surplusPhotoFile && locData) {
        uploadedPhotoInfo = await uploadInspectionPhoto(
          surplusPhotoFile,
          currentHall,
          locData.locationCode,
          setSurplusProgress
        );
        if (uploadedPhotoInfo?.photoId) {
          setUploads((prev) => [...prev, {
            id: uploadedPhotoInfo.photoId, file: surplusPhotoFile, progress: 100, status: 'saved',
          }]);
          setPhotos((prev) => [
            ...prev,
            {
              photoId: uploadedPhotoInfo.photoId,
              objectKey: uploadedPhotoInfo.objectKey,
              previewUrl: uploadedPhotoInfo.previewUrl,
              sku: surplusMode === 'SKU' ? surplusSkuInput.trim() : (surplusMode === 'BARCODE' ? `条码:${surplusBarcodeInput.trim()}` : '无SKU未知品'),
            },
          ]);
        }
      }

      const newSurplusItem: LocationSkuItem = {
        sku: surplusMode === 'SKU' ? surplusSkuInput.trim() : (surplusMode === 'BARCODE' ? `条码:${surplusBarcodeInput.trim()}` : '无SKU未知品'),
        barcode: surplusMode === 'BARCODE' ? surplusBarcodeInput.trim() : '',
        eBarcode: '',
        customerCode: '',
        nameZh: surplusMode === 'NO_SKU' ? '无SKU商品(已拍照)' : (surplusNotesInput.trim() || '现场多货'),
        nameEn: '',
        systemQty: 0,
        availableQty: 0,
        allocatedQty: 0,
        frozenQty: 0,
        actualQty: qty,
        differenceQty: qty,
        discrepancyType: surplusMode === 'NO_SKU' ? 'NO_SKU_SURPLUS' : 'SURPLUS',
        notes: surplusNotesInput.trim() || `现场多货 ${qty} 件 (${surplusMode})`,
        isReturn: surplusIsReturn,
        returnCode: surplusIsReturn ? surplusReturnCode.trim() : '',
      };

      setSkuList((prev) => [...prev, newSurplusItem]);
      setIsEmptyConfirmed(false);

      // Reset modal
      setShowSurplusModal(false);
      setSurplusSkuInput('');
      setSurplusBarcodeInput('');
      setSurplusQtyInput('1');
      setSurplusNotesInput('');
      setSurplusIsReturn(false);
      setSurplusReturnCode('');
      setSurplusPhotoFile(null);
      setSurplusPhotoPreview(null);
      triggerHaptic(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSurplusUploadFailed(true);
      alert(`添加多货失败: ${msg}`);
      triggerHaptic(false);
    } finally {
      setUploadingSurplusPhoto(false);
    }
  };

  // Keep original Files unchanged; at most two uploads run concurrently.
  const uploadPhoto = async (task: PhotoUpload) => {
    if (!locData) return;
    setErrorMsg(null);
    const key = locationKey(locData.hallId, locData.locationCode, locData.referenceImportId);
    uploadsInFlight.current++;
    const update = (patch: Partial<PhotoUpload>, photo?: InspectionPhotoItem) => {
      const draft = locationDrafts.get(key);
      if (draft) {
        draft.uploads = draft.uploads.map((item) => item.id === task.id ? { ...item, ...patch } : item);
        if (photo) draft.photos = [...draft.photos, photo];
      }
      if (activeKey.current === key) {
        setUploads((prev) => prev.map((item) => item.id === task.id ? { ...item, ...patch } : item));
        if (photo) setPhotos((prev) => [...prev, photo]);
      }
    };
    update({ status: 'uploading', progress: 0 });
    try {
      const result = await uploadInspectionPhoto(task.file, locData.hallId, locData.locationCode,
        (progress) => update({ progress }));
      update({ status: 'saved', progress: 100 }, {
        photoId: result.photoId, objectKey: result.objectKey, previewUrl: result.previewUrl,
        sku: task.sku || undefined,
      });
      triggerHaptic(true);
    } catch (error) {
      update({ status: 'error' });
      if (activeKey.current === key) setErrorMsg(error instanceof Error ? error.message : String(error));
      triggerHaptic(false);
    } finally {
      uploadsInFlight.current--;
    }
  };

  const handleLocationPhotoUpload = async (files: File[]) => {
    if (!locData || uploadsInFlight.current) return;
    const tasks: PhotoUpload[] = files.map((file) => ({
      id: crypto.randomUUID(), file, progress: 0, status: 'uploading', sku: photoTargetSku || undefined,
    }));
    const key = locationKey(locData.hallId, locData.locationCode, locData.referenceImportId);
    locationDrafts.set(key, {
      data: locData, skus: skuList, photos, notes: locationNotes,
      empty: isEmptyConfirmed, uploads: [...uploads, ...tasks],
    });
    setUploads((prev) => [...prev, ...tasks]);
    for (let index = 0; index < tasks.length; index += 2) {
      await Promise.all(tasks.slice(index, index + 2).map(uploadPhoto));
    }
  };

  // Save current location inspection to Cloudflare D1
  const handleSaveInspection = async (items = skuList, empty = isEmptyConfirmed, notes = locationNotes, linkedPhotos = photos, reset = false) => {
    if (!locData || saving || photoBusy || photoFailed || uploadingSurplusPhoto) return;

    // Check if all SKUs have been verified
    const unverifiedCount = items.filter((s) => s.actualQty === null || s.actualQty === undefined).length;
    if (unverifiedCount > 0 && !empty) {
      const confirmSave = confirm(`当前库位仍有 ${unverifiedCount} 个 SKU 未核查确认，是否确定提交暂存？`);
      if (!confirmSave) return;
    }

    setSaving(true);
    setSaveSuccessMsg(null);
    setErrorMsg(null);

    const hasAnyDiscrepancy = items.some((s) => s.discrepancyType && s.discrepancyType !== 'NORMAL');
    const incomplete = unverifiedCount > 0 || (items.length === 0 && !empty);
    const finalStatus = incomplete ? 'IN_PROGRESS' : hasAnyDiscrepancy ? 'PENDING_REVIEW' : 'VERIFIED';

    const payload = {
      hallId: currentHall,
      referenceImportId: locData.referenceImportId,
      locationCode: locData.locationCode,
      isEmptyConfirmed: empty,
      status: finalStatus,
      notes,
      reset,
      skus: items.filter((s) => s.actualQty !== null && s.actualQty !== undefined).map((s) => ({
        sku: s.sku,
        barcode: s.barcode,
        eBarcode: s.eBarcode,
        customerCode: s.customerCode,
        nameZh: s.nameZh,
        systemQty: s.systemQty,
        actualQty: s.actualQty ?? 0,
        differenceQty: s.differenceQty ?? 0,
        discrepancyType: s.discrepancyType || 'NORMAL',
        notes: s.notes,
        isReturn: Boolean(s.isReturn),
        returnCode: s.isReturn ? s.returnCode || '' : '',
      })),
      photos: linkedPhotos.map((p) => ({
        photoId: p.photoId,
        objectKey: p.objectKey,
        sku: p.sku,
      })),
    };

    try {
      const saved = await saveLocationInspection(payload);
      const savedData: LocationAuditData = { ...locData, skus: items,
        lastInspection: incomplete ? locData.lastInspection : { completedAt: saved.savedAt, versionNumber: locData.versionNumber }, inspection: {
        inspectionId: saved.inspectionId, status: finalStatus, isEmptyConfirmed: empty,
        notes, completedAt: incomplete ? null : saved.savedAt, photos: linkedPhotos,
      } };
      const key = locationKey(locData.hallId, locData.locationCode, locData.referenceImportId);
      locationDrafts.set(key, { data: savedData, skus: items, photos: linkedPhotos,
        notes, empty, uploads: [],
      });
      if (activeKey.current !== key) return;
      setLocData(savedData);
      setSkuList(items);
      setPhotos(linkedPhotos);
      setLocationNotes(notes);
      setIsEmptyConfirmed(empty);
      setUploads([]);
      setSaveSuccessMsg(incomplete ? t('draftSaved') : t('saved'));
      triggerHaptic(true);
      // IME-based PDA scanners need an editable target after the save button took focus.
      if (androidScanner) focusScanner();

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`保存失败: ${msg}`);
      triggerHaptic(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-2 sm:px-4 py-3 space-y-3 font-sans pb-24">
      {/* Top Banner: Hall & Active Version Status */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-sm">{currentHall} {t('hall')}</span>
          {activeVersionInfo ? (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono border border-blue-200">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></span>
              V{activeVersionInfo.version_number} ({activeVersionInfo.source_exported_at ? activeVersionInfo.source_exported_at.split('T')[0] : t('active')})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              {t('noWms')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!activeVersionInfo && (
            <button
              type="button"
              onClick={onOpenImport}
              className="bg-blue-600 text-white font-medium px-2 py-1 rounded hover:bg-blue-700 transition"
            >
              {t('pcImport')}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenTest}
            className="text-slate-500 hover:text-slate-700 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 transition"
          >
            {t('hardware')}
          </button>
        </div>
      </div>

      {/* Main Barcode Scanner Wedge & Search Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={scanInputRef}
              type="text"
              inputMode={manualInput ? 'text' : androidScanner ? undefined : 'none'}
              value={inputLoc}
              onChange={handleScanChange}
              onKeyDown={handleScanKeyDown}
              placeholder={t('scanner')}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-9 pr-8 py-2.5 text-base font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition"
              {...{ virtualkeyboardpolicy: !manualInput && virtualKeyboard ? 'manual' : 'auto' }}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <Scan className="w-5 h-5 text-slate-400 absolute left-2.5 top-3" />
            {inputLoc && (
              <button
                type="button"
                onClick={() => {
                  setInputLoc('');
                  focusScanner();
                }}
                className="absolute right-2.5 top-3 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            aria-label={manualInput ? t('scannerMode') : t('manualLocation')}
            aria-pressed={manualInput}
            onClick={() => {
              setManualInput(!manualInput);
              if (manualInput) scanInputRef.current?.blur();
              focusScanner(!manualInput);
            }}
            className="text-slate-600 bg-slate-100 px-2 rounded-lg"
          >
            <Keyboard className="w-5 h-5" />
          </button>
          <button
            type="button"
            onPointerDown={keepScannerFocus}
            onClick={() => handleQueryLocation(inputLoc)}
            disabled={loading || saving || photoBusy || !inputLoc.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1 shadow-sm transition active:scale-95"
          >
            {loading ? <RotateCw className="w-4 h-4 animate-spin" /> : t('query')}
          </button>
        </div>

        {/* First-segment vertical navigation; other segments remain unchanged. */}
        {locData && /^\d+-\d+-\d+$/.test(locData.locationCode) && (
          <div className="flex items-center justify-center gap-3 mt-2 text-xs">
            <button type="button" aria-label={t('rowUp')} onPointerDown={keepScannerFocus}
              disabled={loading || saving || photoBusy || !verticalLocation(-1)}
              onClick={() => { const code = verticalLocation(-1); if (code) handleQueryLocation(code); }}
              className="flex items-center gap-1 px-3 py-1 rounded bg-slate-100 disabled:opacity-30">
              <ChevronUp className="w-5 h-5" /> {verticalLocation(-1) || '—'}
            </button>
            <button type="button" aria-label={t('rowDown')} onPointerDown={keepScannerFocus}
              disabled={loading || saving || photoBusy || !verticalLocation(1)}
              onClick={() => { const code = verticalLocation(1); if (code) handleQueryLocation(code); }}
              className="flex items-center gap-1 px-3 py-1 rounded bg-slate-100 disabled:opacity-30">
              <ChevronDown className="w-5 h-5" /> {verticalLocation(1) || '—'}
            </button>
          </div>
        )}
        {/* Adjacent middle-segment codes; actual row ends are entered manually. */}
        {locData?.navigation && (
          <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            <button
              type="button"
              onPointerDown={keepScannerFocus}
              aria-label={t('previous')}
              disabled={loading || saving || photoBusy || !locData.navigation.prevLocationCode}
              onClick={() => locData.navigation.prevLocationCode && handleQueryLocation(locData.navigation.prevLocationCode)}
              className="flex flex-col sm:flex-row items-center gap-1 p-2 rounded bg-slate-100 text-slate-700 disabled:opacity-30 active:bg-slate-200"
            >
              <ChevronLeft className="w-5 h-5 shrink-0" />
              <span className="font-mono">{locData.navigation.prevLocationCode || '—'}</span>
            </button>
            <strong className="font-mono text-blue-600 text-sm">{locData.locationCode}</strong>
            <button
              type="button"
              onPointerDown={keepScannerFocus}
              aria-label={t('next')}
              disabled={loading || saving || photoBusy || !locData.navigation.nextLocationCode}
              onClick={() => locData.navigation.nextLocationCode && handleQueryLocation(locData.navigation.nextLocationCode)}
              className="flex flex-col-reverse sm:flex-row items-center gap-1 p-2 rounded bg-slate-100 text-slate-700 disabled:opacity-30 active:bg-slate-200"
            >
              <span className="font-mono">{locData.navigation.nextLocationCode || '—'}</span>
              <ChevronRight className="w-5 h-5 shrink-0" />
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-lg text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {saveSuccessMsg && (
        <div role="status" className="fixed top-28 left-1/2 -translate-x-1/2 z-50 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-lg text-xs flex items-center gap-2 pointer-events-none shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{saveSuccessMsg}</span>
        </div>
      )}

      {/* Active Location Inspection View */}
      {locData && (
        <div className="space-y-3">
          {/* Location Summary Header Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 font-medium">{t('currentPhysical')}</span>
                <h2 className="text-2xl font-bold font-mono text-slate-900 tracking-tight flex items-center gap-2">
                  {locData.locationCode}
                  {isEmptyConfirmed && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-normal font-sans border border-slate-200">
                      {t('emptyConfirm')}
                    </span>
                  )}
                </h2>
              </div>

              {/* Quick 1-Tap All Normal Button */}
              {locData.hasBookStock && !isEmptyConfirmed && (
                <button
                  type="button"
                  onPointerDown={keepScannerFocus}
                  onClick={handleSetAllNormal}
                  disabled={saving || loading || photoBusy || photoFailed || uploadingSurplusPhoto}
                  className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm active:scale-95 transition"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  {t('allNormal')}
                </button>
              )}
            </div>

            {locData.lastInspection && (
              <p className="mt-2 text-xs text-slate-500">
                {locData.lastInspection.versionNumber === locData.versionNumber ? t('inspected') : t('previouslyInspected')}：
                {new Date(locData.lastInspection.completedAt).toLocaleString('zh-CN', { hour12: false })}
                {locData.lastInspection.versionNumber !== locData.versionNumber && `（V${locData.lastInspection.versionNumber}，当前 V${locData.versionNumber} 待核查）`}
              </p>
            )}

            {/* Sparse Location Notification */}
            {!locData.hasBookStock && (
              <div className="mt-2 bg-amber-50 border border-amber-200 p-2.5 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-amber-800">
                  <FileQuestion className="w-4 h-4 text-amber-600" />
                  <span>{t('wmsEmpty')}</span>
                </div>
                <button
                  type="button"
                  onPointerDown={keepScannerFocus}
                  disabled={saving || loading || photoBusy || photoFailed || uploadingSurplusPhoto}
                  onClick={handleConfirmEmpty}
                  className={`text-xs font-medium px-2.5 py-1 rounded transition ${
                    isEmptyConfirmed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  {isEmptyConfirmed ? t('emptyConfirmed') : t('emptyConfirm')}
                </button>
              </div>
            )}
          </div>

          {/* Aggregated SKU List for this Location */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-700">
                库位商品列表 ({skuList.length} 个 SKU)
              </span>
              <button
                type="button"
                disabled={photoBusy || saving || loading}
                onClick={() => { setManualInput(false); setSurplusUploadFailed(false); setShowSurplusModal(true); }}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 active:scale-95 transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                {t('surplusAdd')}
              </button>
            </div>

            {skuList.map((item, idx) => {
              const isNormal = item.discrepancyType === 'NORMAL';
              const isShortage = item.discrepancyType === 'SHORTAGE';
              const isSurplus = item.discrepancyType === 'SURPLUS' || item.discrepancyType === 'NO_SKU_SURPLUS';
              const hasDiff = item.differenceQty !== null && item.differenceQty !== 0;

              return (
                <div
                  key={`${item.sku}_${idx}`}
                  className={`bg-white rounded-xl border p-3 shadow-sm transition ${
                    isShortage
                      ? 'border-red-300 bg-red-50/20'
                      : isSurplus
                      ? 'border-amber-300 bg-amber-50/20'
                      : isNormal
                      ? 'border-emerald-300 bg-emerald-50/10'
                      : 'border-slate-200'
                  }`}
                >
                  {/* Top Bar: SKU & Identification */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-base text-slate-900 break-all">
                          {item.sku}
                        </span>
                        {item.customerCode && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                            {t('customer')}{item.customerCode}
                          </span>
                        )}
                        {item.barcode && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded border border-blue-200 font-mono">
                            {t('barcodeLabel')}{item.barcode}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                        {item.nameZh || t('noChineseName')}
                      </p>
                    </div>

                    {/* Discrepancy Status Tag */}
                    <div>
                      {isNormal && (
                        <span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          <Check className="w-3 h-3" /> {t('match')}
                        </span>
                      )}
                      {isShortage && (
                        <span className="inline-flex items-center gap-0.5 bg-red-100 text-red-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          {t('shortage')} {Math.abs(item.differenceQty || 0)}
                        </span>
                      )}
                      {isSurplus && (
                        <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          多货 +{item.differenceQty || 0}
                        </span>
                      )}
                      {!item.discrepancyType && (
                        <span className="bg-slate-100 text-slate-500 text-[11px] px-2 py-0.5 rounded-full font-medium">
                          {t('unchecked')}
                        </span>
                      )}
                    </div>
                  </div>

                  {item.isReturn && (
                    <p className="mt-2 text-xs text-slate-600 break-all">
                      {t('returnShort')}{item.returnCode ? ` · 退货码或跟踪号：${item.returnCode}` : ''}
                    </p>
                  )}

                  {/* Stock Quantities Grid (6 Pillars) */}
                  <div className="grid grid-cols-6 gap-1 mt-2.5 pt-2 border-t border-slate-100 text-center">
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] text-slate-400">{t('book')}</div>
                      <div className="text-sm font-bold text-slate-800 font-mono">{item.systemQty}</div>
                    </div>
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] text-slate-400">{t('available')}</div>
                      <div className="text-xs font-semibold text-slate-700 font-mono">{item.availableQty}</div>
                    </div>
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] text-slate-400">{t('allocated')}</div>
                      <div className="text-xs font-semibold text-slate-700 font-mono">{item.allocatedQty}</div>
                    </div>
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] text-slate-400">{t('frozen')}</div>
                      <div className="text-xs font-semibold text-slate-700 font-mono">{item.frozenQty}</div>
                    </div>
                    <div className={`rounded p-1 ${item.actualQty !== null ? 'bg-blue-50 text-blue-900' : 'bg-slate-50 text-slate-400'}`}>
                      <div className="text-[10px] font-medium">{t('actual')}</div>
                      <div className="text-sm font-bold font-mono">
                        {item.actualQty !== null ? item.actualQty : '-'}
                      </div>
                    </div>
                    <div className={`rounded p-1 ${
                      hasDiff
                        ? isShortage
                          ? 'bg-red-100 text-red-900 font-bold'
                          : 'bg-amber-100 text-amber-900 font-bold'
                        : isNormal
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-slate-50 text-slate-400'
                    }`}>
                      <div className="text-[10px]">{t('difference')}</div>
                      <div className="text-sm font-mono font-bold">
                        {item.differenceQty !== null ? (item.differenceQty > 0 ? `+${item.differenceQty}` : item.differenceQty) : '-'}
                      </div>
                    </div>
                  </div>

                  {/* SKU Action Buttons */}
                  <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => handleSetSkuNormal(idx)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 active:scale-95 transition"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {t('normal')}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenShortage(item)}
                      className="bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 border border-slate-200 active:scale-95 transition"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                      {t('shortage')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Location Inspection Photos Section */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-blue-600" />
                现场照片存证 ({photos.length} 张)
              </span>

              <button
                type="button"
                disabled={photoBusy || saving}
                onClick={() => fileInputRef.current?.click()}
                className="text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 px-2.5 py-1 rounded font-medium flex items-center gap-1"
              >
                {t('photoAdd')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleLocationPhotoUpload(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
            </div>

            <label className="block text-xs text-slate-600">
              {t('photoAssign')}
              <select aria-label={t("photoTarget")} value={photoTargetSku} onChange={event => setPhotoTargetSku(event.target.value)}
                className="ml-2 border border-slate-300 rounded px-2 py-1 bg-white max-w-full">
                <option value="">{t('wholeLocation')}</option>
                {skuList.map((item, index) => (
                  <option key={index} value={item.sku}>{item.sku || t('noSku')} · {item.discrepancyType || t('unchecked')}</option>
                ))}
              </select>
            </label>
            {uploads.map((upload) => (
              <div key={upload.id} className="text-xs text-slate-600 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{upload.file.name}</span>
                  {upload.status === 'error' ? (
                    <button type="button" disabled={photoBusy || saving} onClick={() => uploadPhoto(upload)} className="text-blue-600 shrink-0">{t('retry')}</button>
                  ) : <span className="shrink-0">{upload.status === 'saved' ? t('saved') : `上传中 ${upload.progress}%${upload.progress === 100 ? '（等待保存）' : ''}`}</span>}
                </div>
                {upload.status === 'uploading' && <progress aria-label="照片上传进度" max={100} value={upload.progress} className="w-full h-2" />}
              </div>
            ))}
            {photoFailed && <p className="text-xs text-red-600">{t('photoRetry')}</p>}
            {photos.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto py-1">
                {photos.map((p) => (
                  <div key={p.photoId} className="relative shrink-0 space-y-1">
                    <img
                      src={p.previewUrl || `/api/inventory/inspection/photo?key=${encodeURIComponent(p.objectKey)}`}
                      alt="Inspection"
                      className="w-16 h-16 object-cover rounded-lg border border-slate-200"
                    />
                    <span className="block text-[10px] truncate max-w-20">{p.sku || t('locationPhoto')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 px-1" data-testid="wms-import-time">
        {t('wmsReference')}{locData ? `V${locData.versionNumber}` : activeVersionInfo ? `V${activeVersionInfo.version_number}` : '未发布'}
        {' · ' + t('uploadedAt')}
        {(locData ? locData.importedAt : activeVersionInfo?.imported_at)
          ? new Date((locData ? locData.importedAt : activeVersionInfo?.imported_at)!).toLocaleString('zh-CN', { hour12: false })
          : t('noUploadTime')}
      </p>

      {/* Floating Bottom Bar: Sticky Operation Controls */}
      {locData && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-2.5 z-40 shadow-lg">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <button
              type="button"
              onPointerDown={keepScannerFocus}
              onClick={() => handleSaveInspection()}
              disabled={saving || loading || photoBusy || photoFailed || uploadingSurplusPhoto}
              className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3 px-3 rounded-xl flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition text-sm disabled:opacity-50"
            >
              {saving ? <RotateCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t('saveLocation')}
            </button>


          </div>
        </div>
      )}

      {/* MODAL: Report Shortage */}
      {shortageModalSku && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                {t('reportShortage')}
              </h3>
              <button
                type="button"
                onClick={() => setShortageModalSku(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
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
              <input
                type="number"
                min="1"
                max={shortageModalSku.systemQty}
                value={shortageCountInput}
                onChange={(e) => setShortageCountInput(e.target.value)}
                placeholder="例如: 2"
                className="w-full text-center text-2xl font-bold font-mono border-2 border-red-300 rounded-lg p-2 focus:outline-none focus:border-red-500"
                autoFocus
              />
              <div className="text-right text-xs text-slate-500 mt-1">
                确认后实盘数量将为: {Math.max(0, shortageModalSku.systemQty - (parseInt(shortageCountInput || '0', 10)))} 件
              </div>
            </div>

            <ReturnFields isReturn={shortageIsReturn} returnCode={shortageReturnCode}
              onReturnChange={value => { setShortageIsReturn(value); if (!value) setShortageReturnCode(''); }}
              onCodeChange={setShortageReturnCode} />

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShortageModalSku(null)}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleSubmitShortage}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-bold shadow-md hover:bg-red-700"
              >
                {t('confirmShortage')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Surplus (现场多货) */}
      {showSurplusModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                <PlusCircle className="w-5 h-5 text-amber-500" />
                {t('addSurplusTitle')}
              </h3>
              <button
                type="button"
                disabled={uploadingSurplusPhoto}
                onClick={() => setShowSurplusModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Selector Pill */}
            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setSurplusMode('SKU')}
                className={`py-1.5 rounded font-medium transition ${
                  surplusMode === 'SKU' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('scanSku')}
              </button>
              <button
                type="button"
                onClick={() => setSurplusMode('BARCODE')}
                className={`py-1.5 rounded font-medium transition ${
                  surplusMode === 'BARCODE' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('scanBarcode')}
              </button>
              <button
                type="button"
                onClick={() => setSurplusMode('NO_SKU')}
                className={`py-1.5 rounded font-medium transition ${
                  surplusMode === 'NO_SKU' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('noSku')}
              </button>
            </div>

            {/* Field: SKU code */}
            {surplusMode === 'SKU' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('skuInputLabel')}
                </label>
                <input
                  ref={surplusSkuRef}
                  type="text"
                  inputMode={manualInput ? 'text' : androidScanner ? undefined : 'none'}
                  {...{ virtualkeyboardpolicy: !manualInput && virtualKeyboard ? 'manual' : 'auto' }}
                  value={surplusSkuInput}
                  onChange={(e) => setSurplusSkuInput(e.target.value.toUpperCase())}
                  placeholder={t('skuPlaceholder')}
                  className="w-full font-mono font-bold text-sm border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                />
                <button type="button" aria-label={t('manual')} onClick={(event) => {
                  const input = event.currentTarget.previousElementSibling as HTMLInputElement;
                  setManualInput(!manualInput);
                  if (manualInput) input.blur();
                  focusScannerInput(input, !manualInput);
                }} className="mt-1 text-slate-600"><Keyboard className="w-4 h-4" /></button>
              </div>
            )}

            {/* Field: Barcode */}
            {surplusMode === 'BARCODE' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('barcodeInputLabel')}
                </label>
                <input
                  ref={surplusBarcodeRef}
                  type="text"
                  inputMode={manualInput ? 'text' : androidScanner ? undefined : 'none'}
                  {...{ virtualkeyboardpolicy: !manualInput && virtualKeyboard ? 'manual' : 'auto' }}
                  value={surplusBarcodeInput}
                  onChange={(e) => setSurplusBarcodeInput(e.target.value.trim())}
                  placeholder={t('barcodePlaceholder')}
                  className="w-full font-mono font-bold text-sm border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                />
                <button type="button" aria-label={t('manual')} onClick={(event) => {
                  const input = event.currentTarget.previousElementSibling as HTMLInputElement;
                  setManualInput(!manualInput);
                  if (manualInput) input.blur();
                  focusScannerInput(input, !manualInput);
                }} className="mt-1 text-slate-600"><Keyboard className="w-4 h-4" /></button>
              </div>
            )}

            {/* Field: No SKU rule notice */}
            {surplusMode === 'NO_SKU' && (
              <div className="bg-amber-50 border border-amber-200 p-2 rounded-lg text-xs text-amber-800">
                <strong>{t('mandatory')}</strong> {t('noSkuExplanation')}
              </div>
            )}

            {/* Field: Quantity */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t('surplusQty')}
              </label>
              <input
                type="number"
                min="1"
                value={surplusQtyInput}
                onChange={(e) => setSurplusQtyInput(e.target.value)}
                placeholder={t('qtyPlaceholder')}
                className="w-full text-center text-xl font-bold font-mono border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            {/* Field: Photo Upload (Mandatory for NO_SKU) */}
            <ReturnFields isReturn={surplusIsReturn} returnCode={surplusReturnCode}
              onReturnChange={value => { setSurplusIsReturn(value); if (!value) setSurplusReturnCode(''); }}
              onCodeChange={setSurplusReturnCode} disabled={uploadingSurplusPhoto} />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {surplusMode === 'NO_SKU' ? (
                  <span className="text-red-600 font-bold">{t('photoRequired')}</span>
                ) : (
                  t('photoOptional')
                )}
              </label>
              <input
                ref={surplusFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleSurplusPhotoChange(e.target.files[0]);
                  }
                }}
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => surplusFileInputRef.current?.click()}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 border border-slate-200"
                >
                  <Camera className="w-4 h-4 text-blue-600" />
                  {surplusPhotoFile ? t('rePhoto') : t('camera')}
                </button>

                {surplusPhotoPreview && (
                  <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-300 shrink-0">
                    <img src={surplusPhotoPreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            </div>

            {/* Field: Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t('notesOptional')}
              </label>
              <input
                type="text"
                value={surplusNotesInput}
                onChange={(e) => setSurplusNotesInput(e.target.value)}
                placeholder={t('notesExample')}
                className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            {uploadingSurplusPhoto && surplusPhotoFile && <progress aria-label="多货照片上传进度" max={100} value={surplusProgress} className="w-full h-2" />}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={uploadingSurplusPhoto}
                onClick={() => setShowSurplusModal(false)}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={uploadingSurplusPhoto}
                onClick={handleSubmitSurplus}
                className="flex-1 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold shadow-md hover:bg-amber-700 disabled:opacity-50"
              >
                {uploadingSurplusPhoto ? `${t('photoUploading')} ${surplusProgress}%` : surplusUploadFailed ? t('retry') : t('surplusConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
