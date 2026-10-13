import { t } from '../i18n';
import React, { useState, useEffect, useRef } from 'react';
import { registerLanguageSafety } from '../i18n/safety';
import * as XLSX from 'xlsx';
import { HallId } from '../types';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Layers,
  History,
  RotateCw,
  Search,
  Check,
  X,
  Clock,
} from 'lucide-react';

interface WMSImportPageProps {
  currentHall: HallId;
}

interface ImportRecord {
  import_id: string;
  hall_id: string;
  version_number: number;
  original_filename: string;
  file_sha256: string;
  imported_at: string;
  source_exported_at: string | null;
  published_at: string | null;
  uploaded_by: string;
  inventory_row_count: number;
  stocked_location_count: number;
  distinct_sku_count: number;
  total_stock_qty: number;
  status: 'STAGING' | 'PUBLISHED' | 'ARCHIVED' | 'FAILED';
  notes: string | null;
}

export const WMSImportPage: React.FC<WMSImportPageProps> = ({ currentHall }) => {
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [importsHistory, setImportsHistory] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // File & Parsing state
  const [file, setFile] = useState<File | null>(null);
  const [fileSha256, setFileSha256] = useState<string>('');
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [existingDuplicateVer, setExistingDuplicateVer] = useState<number | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [previewStats, setPreviewStats] = useState<{
    totalRows: number;
    locations: number;
    skus: number;
    totalQty: number;
    equationPassed: boolean;
    hallMismatch: boolean;
  } | null>(null);
  const [sourceExportDate, setSourceExportDate] = useState<string>('');

  // Upload progress
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string>('');
  const [isPublishing, setIsPublishing] = useState(false);

  // Barcode Test (Decision 1 & 3 Verification)
  const [testBarcodeQuery, setTestBarcodeQuery] = useState('');
  const [barcodeSearchResult, setBarcodeSearchResult] = useState<any | null>(null);
  const [searchingBarcode, setSearchingBarcode] = useState(false);

  const languageSafetyRef = useRef({dirty: false, busy: false});
  languageSafetyRef.current = {dirty: Boolean(file || fileSha256 || parsedRows.length || sourceExportDate && file), busy: isPublishing || loading || searchingBarcode};
  useEffect(() => registerLanguageSafety('import', {
    dirty: () => languageSafetyRef.current.dirty,
    busy: () => languageSafetyRef.current.busy,
  }), []);

  // Load version list
  const loadImports = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/imports?hallId=${currentHall}`);
      const json = await res.json();
      if (json.success) {
        setActiveImportId(json.data.activeImportId);
        setImportsHistory(json.data.imports);
      }
    } catch (err) {
      console.error('Failed to load imports history', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImports();
  }, [currentHall]);

  // Compute SHA-256 in browser
  const computeSha256 = async (buffer: ArrayBuffer): Promise<string> => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  // Handle file drop/selection
  const handleFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setUploadStatusMsg('');
    setUploadProgress(0);
    setIsDuplicate(false);

    // Auto extract date from filename (e.g. 库位库存_20261010.xlsx -> 2026-10-10)
    const dateMatch = selectedFile.name.match(/(\d{4})(\d{2})(\d{2})/);
    if (dateMatch) {
      setSourceExportDate(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
    } else {
      setSourceExportDate(new Date().toISOString().split('T')[0]);
    }

    const buffer = await selectedFile.arrayBuffer();
    const sha = await computeSha256(buffer);
    setFileSha256(sha);

    // Check duplicate with backend
    try {
      const checkRes = await fetch('/api/inventory/imports/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hallId: currentHall, sha256: sha }),
      });
      const checkJson = await checkRes.json();
      if (checkJson.isDuplicate) {
        setIsDuplicate(true);
        setExistingDuplicateVer(checkJson.existingImport.version_number);
      }
    } catch (err) {
      console.error('Error checking duplicate SHA', err);
    }

    // Parse Excel / CSV using XLSX
    try {
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (rawRows.length < 2) {
        setUploadStatusMsg(t('emptyFile'));
        return;
      }

      const dataRows = rawRows.slice(1).filter((r) => r.length > 0 && r[0]);

      // Calculate preview statistics
      const locSet = new Set<string>();
      const skuSet = new Set<string>();
      let totalQty = 0;
      let eqPassed = true;
      let hallMismatch = false;

      const normalizedRows = dataRows.map((r) => {
        const rowHall = String(r[6] || '').trim().toUpperCase();
        if (rowHall && rowHall !== currentHall) {
          hallMismatch = true;
        }

        const loc = String(r[7] || '').trim();
        const sku = String(r[0] || '').trim();
        const stockQty = parseInt(r[8] || '0', 10);
        const availQty = parseInt(r[10] || '0', 10);
        const allocQty = parseInt(r[11] || '0', 10);
        const frozenQty = parseInt(r[12] || '0', 10);

        if (stockQty !== availQty + allocQty + frozenQty) {
          eqPassed = false;
        }

        locSet.add(loc);
        skuSet.add(sku);
        totalQty += stockQty;

        return {
          sku,
          barcode: String(r[1] || '').trim(),
          eBarcode: String(r[2] || '').trim(),
          customerCode: String(r[3] || '').trim(),
          nameZh: String(r[4] || '').trim(),
          nameEn: String(r[5] || '').trim(),
          hallId: currentHall,
          locationCode: loc,
          systemQty: stockQty,
          volumeM3: parseFloat(r[9] || '0'),
          availableQty: availQty,
          allocatedQty: allocQty,
          frozenQty: frozenQty,
          dimensionsCm: String(r[13] || '').trim(),
          weightKg: parseFloat(r[14] || '0'),
          cargoType: String(r[15] || '').trim(),
          isNewProduct: String(r[16] || '').trim().toUpperCase() === 'Y',
          isElectric: String(r[17] || '').trim().toUpperCase() === 'Y',
        };
      });

      setParsedRows(normalizedRows);
      setPreviewStats({
        totalRows: normalizedRows.length,
        locations: locSet.size,
        skus: skuSet.size,
        totalQty,
        equationPassed: eqPassed,
        hallMismatch,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadStatusMsg(`${t('parsingError')} ${msg}`);
    }
  };

  // Upload chunks to Staging and Publish
  const handleUploadAndPublish = async () => {
    if (!file || parsedRows.length === 0) return;
    setUploadProgress(5);
    setUploadStatusMsg(t('initializing'));

    try {
      // 1. Stage session
      const stageRes = await fetch('/api/inventory/imports/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hallId: currentHall,
          filename: file.name,
          fileSha256,
          sourceExportedAt: sourceExportDate ? `${sourceExportDate}T00:00:00Z` : undefined,
          expectedRowCount: parsedRows.length,
          notes: `Web 拖拽导入 (校验等式: ${previewStats?.equationPassed ? '通过' : '有异常'})`,
        }),
      });

      const stageJson = await stageRes.json();
      if (!stageJson.success) {
        throw new Error(stageJson.error || t('creatingStageError'));
      }

      const importId = stageJson.importId;

      // 2. Upload chunks (batch of 60 rows)
      const chunkSize = 60;
      const totalChunks = Math.ceil(parsedRows.length / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = parsedRows.slice(i * chunkSize, (i + 1) * chunkSize);
        const chunkRes = await fetch('/api/inventory/imports/chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            importId,
            hallId: currentHall,
            rows: chunk,
          }),
        });

        const chunkJson = await chunkRes.json();
        if (!chunkJson.success) {
          throw new Error(chunkJson.error || `${t('upload')} ${i + 1}: ${t('saveFailed')}`);
        }

        const pct = Math.round(((i + 1) / totalChunks) * 80) + 10;
        setUploadProgress(pct);
        setUploadStatusMsg(`${t('alreadyUploaded')} ${Math.min((i + 1) * chunkSize, parsedRows.length)} / ${parsedRows.length} ${t('recordCountUnit')}`);
      }

      // 3. Publish atomic version
      setIsPublishing(true);
      setUploadStatusMsg(t('publishing'));

      const pubRes = await fetch('/api/inventory/imports/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId, hallId: currentHall, includeImports: true }),
      });

      const pubJson = await pubRes.json();
      if (!pubJson.success) {
        throw new Error(pubJson.error || t('publishError'));
      }

      setUploadProgress(100);
      setUploadStatusMsg(`${t('successfulPublish')} ${currentHall} ${t('activeVersion')} (${t('versionNumber')} V${pubJson.versionNumber})!`);
      setFile(null);
      setFileSha256('');
      setParsedRows([]);
      setPreviewStats(null);
      if (Array.isArray(pubJson.imports)) {
        setActiveImportId(pubJson.activeImportId);
        setImportsHistory(pubJson.imports);
      } else {
        await loadImports();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadStatusMsg(`❌ ${t('operationError')} ${msg}`);
    } finally {
      setIsPublishing(false);
    }
  };

  // Test barcode search
  const handleTestSearchBarcode = async () => {
    if (!testBarcodeQuery.trim()) return;
    setSearchingBarcode(true);
    setBarcodeSearchResult(null);

    try {
      const res = await fetch(`/api/inventory/search-barcode?hallId=${currentHall}&barcode=${encodeURIComponent(testBarcodeQuery.trim())}`);
      const json = await res.json();
      setBarcodeSearchResult(json);
    } catch (err) {
      console.error('Barcode search error', err);
    } finally {
      setSearchingBarcode(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-3 py-4 space-y-5">
      {/* Hall Context Banner */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand-600" />
            <h1 className="text-base font-bold text-slate-800">
              {currentHall} {t('wmsTitle')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 pt-0.5">
            {t('wmsSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeImportId ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {t('currentActive')} {activeImportId}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 rounded-lg text-xs font-semibold border border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              {t('noPublished')}
            </span>
          )}
          <button
            type="button"
            onClick={loadImports}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 disabled:opacity-50"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Upload & Staging Card */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 space-y-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Upload className="w-4 h-4 text-brand-600" />
          {t('uploadWms')}
        </h2>

        {/* Drop Zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFile(e.dataTransfer.files[0]);
            }
          }}
          className="border-2 border-dashed border-slate-300 hover:border-brand-500 rounded-xl p-6 text-center bg-slate-50/50 hover:bg-brand-50/20 transition cursor-pointer"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.xlsx,.xls,.csv';
            input.onchange = (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) handleFile(f);
            };
            input.click();
          }}
        >
          <FileSpreadsheet className="w-8 h-8 text-brand-500 mx-auto mb-2" />
          <span className="text-xs font-bold text-slate-700 block">
            {file ? file.name : t('dropExcel')}
          </span>
          <span className="text-[11px] text-slate-400 block pt-1">
            {t('colSupport')}
          </span>
        </div>

        {/* Duplicate Hash Warning */}
        {isDuplicate && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold">{t('duplicateDetected')}</span>
              {t('duplicateWarningBefore')} <strong>V{existingDuplicateVer}</strong> {t('duplicateWarningAfter')}
            </div>
          </div>
        )}

        {/* Preview Summary Card */}
        {previewStats && (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-400 block text-[10px]">{t('detailRows')}</span>
                <span className="font-bold text-slate-800 text-sm">{previewStats.totalRows}</span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-400 block text-[10px]">{t('stockedLocationCount')}</span>
                <span className="font-bold text-slate-800 text-sm">{previewStats.locations}</span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-400 block text-[10px]">{t('skuVarieties')}</span>
                <span className="font-bold text-slate-800 text-sm">{previewStats.skus}</span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-400 block text-[10px]">{t('totalStockPieces')}</span>
                <span className="font-bold text-brand-600 text-sm">{previewStats.totalQty} {t('pieces')}</span>
              </div>
            </div>

            {/* Decision 4 Option A: Export Date Confirmation */}
            <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <Clock className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-slate-600 shrink-0">{t('exportBaseline')}</span>
              <input
                type="date"
                value={sourceExportDate}
                onChange={(e) => setSourceExportDate(e.target.value)}
                className="px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 font-mono"
              />
              <span className="text-[10px] text-slate-400">{t('dateHint')}</span>
            </div>

            {/* Validation Badges */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium ${
                previewStats.equationPassed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                {previewStats.equationPassed ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                {t('quantityEquation')}
              </span>

              {previewStats.hallMismatch && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium bg-rose-50 text-rose-700 border border-rose-200">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('hallMismatch')}
                </span>
              )}
            </div>

            {/* Progress bar */}
            {uploadProgress > 0 && (
              <div className="space-y-1">
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-brand-600 h-2 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-600">{uploadStatusMsg}</p>
              </div>
            )}

            {/* Publish Button */}
            <button
              type="button"
              onClick={handleUploadAndPublish}
              disabled={isPublishing}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Upload className="w-4 h-4" />
              {isPublishing ? t('publishBusy') : `${t('publishConfirm')} ${currentHall} ${t('newVersion')}`}
            </button>
          </div>
        )}
      </div>

      {/* Barcode Ambiguity Verification Tester (Decision 1-A & Decision 3-A) */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Search className="w-4 h-4 text-brand-600" />
          {t('barcodeTest')}
        </h2>
        <p className="text-xs text-slate-500">
          {t('barcodeExplanationBefore')} <strong>{t('barcodeIndex')}</strong> {t('barcodeExplanationAfter')} <code dir="ltr">XBDYDW096HEA0X</code> {t('barcodeExplanationEnd')}
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={testBarcodeQuery}
            onChange={(e) => setTestBarcodeQuery(e.target.value)}
            placeholder={t('barcodeSearchPlaceholder')}
            className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
          />
          <button
            type="button"
            onClick={handleTestSearchBarcode}
            disabled={searchingBarcode || !activeImportId}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
          >
            {searchingBarcode ? t('searching') : t('testSearch')}
          </button>
        </div>

        {/* Quick sample chips */}
        <div className="flex flex-wrap gap-1.5 text-xs text-slate-500 items-center">
          <span className="text-[11px] text-slate-400">{t('testCases')}</span>
          <button
            type="button"
            onClick={() => setTestBarcodeQuery('XBDYDW096HEA0X')}
            className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 text-[11px]"
          >
            {t('barcodeSub')} <span dir="ltr">XBDYDW096HEA0X</span>
          </button>
          <button
            type="button"
            onClick={() => setTestBarcodeQuery('F11103774538')}
            className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 text-[11px]"
          >
            {t('barcodeSimple')} <span dir="ltr">F11103774538</span>
          </button>
          <button
            type="button"
            onClick={() => setTestBarcodeQuery('46')}
            className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 text-[11px]"
          >
            {t('barcodeAmbiguous')} <span dir="ltr">46</span>
          </button>
        </div>

        {/* Search Result */}
        {barcodeSearchResult && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800">
                {t('skuNumberMatched')} {barcodeSearchResult.candidates?.length ?? 0})
              </span>
              {barcodeSearchResult.isAmbiguous ? (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-semibold rounded text-[11px]">
                  {t('manyMatches')}
                </span>
              ) : barcodeSearchResult.found ? (
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-semibold rounded text-[11px]">
                  {t('oneMatch')}
                </span>
              ) : (
                <span className="text-slate-400 text-[11px]">{t('noMatches')}</span>
              )}
            </div>

            {barcodeSearchResult.candidates?.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {barcodeSearchResult.candidates.map((c: any, i: number) => (
                  <div key={i} className="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-slate-900 block">{c.sku}</span>
                      <span className="text-[11px] text-slate-500">{c.name_zh || c.name_en}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 text-[11px] block">{t('location')}: <span dir="ltr">{c.location_code}</span></span>
                      <span className="font-bold text-brand-600">{t('book')}: {c.system_qty} {t('pieces')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Historical Versions Table */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <History className="w-4 h-4 text-brand-600" />
          {currentHall} {t('historyTitle')} ({importsHistory.length})
        </h2>

        {importsHistory.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">{t('noHistory')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table dir="ltr" className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 text-[11px]">
                  <th className="py-2 px-2">{t('version')}</th>
                  <th className="py-2 px-2">{t('filename')}</th>
                  <th className="py-2 px-2">{t('dataImported')}</th>
                  <th className="py-2 px-2">{t('stockRow')}</th>
                  <th className="py-2 px-2">{t('skuNumber')}</th>
                  <th className="py-2 px-2">{t('totalQuantity')}</th>
                  <th className="py-2 px-2">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {importsHistory.map((imp) => {
                  const isActive = imp.import_id === activeImportId;
                  return (
                    <tr key={imp.import_id} className={`hover:bg-slate-50 ${isActive ? 'bg-emerald-50/40' : ''}`}>
                      <td className="py-2.5 px-2 font-bold font-mono text-slate-900">
                        V{imp.version_number}
                        {isActive && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[10px] font-normal">
                            {t('active')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-slate-700 truncate max-w-[180px]" title={imp.original_filename}>
                        {imp.original_filename}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-500 text-[11px]">
                        {imp.imported_at ? imp.imported_at.replace('T', ' ').substring(0, 19) : '-'}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-800">{imp.stocked_location_count}</td>
                      <td className="py-2.5 px-2 font-mono text-slate-800">{imp.distinct_sku_count}</td>
                      <td className="py-2.5 px-2 font-mono font-bold text-brand-600">{imp.total_stock_qty}</td>
                      <td className="py-2.5 px-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          imp.status === 'PUBLISHED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : imp.status === 'STAGING'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {imp.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
