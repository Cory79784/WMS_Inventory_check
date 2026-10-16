import { useEffect, useRef, useState } from 'react';
import { GitCompareArrows, ChevronRight, Download } from 'lucide-react';
import { t } from '../i18n';
import type { HallId, SnapshotComparison, SnapshotVersion } from '../types';
import type { ExportLanguage } from '../services/exportLanguage';
import { compareSnapshots, fetchSnapshotVersions } from '../services/snapshotCompare';
const PAGE_SIZE = 20;
interface Props {
    hallId: HallId;
    language: ExportLanguage;
    onInspectLocation?: (location: string) => void;
}
export function SnapshotComparisonPanel({ hallId, language, onInspectLocation }: Props) {
    const [open, setOpen] = useState(false), [versions, setVersions] = useState<SnapshotVersion[] | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null), [oldId, setOldId] = useState(''), [newId, setNewId] = useState('');
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
    const [retry, setRetry] = useState(0);
    const [error, setError] = useState(''), [result, setResult] = useState<SnapshotComparison | null>(null);
    const [page, setPage] = useState(1), [search, setSearch] = useState('');
    const controller = useRef<AbortController | null>(null), mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
    useEffect(() => {
        if (!open || versions !== null)
            return;
        const abort = new AbortController();
        setLoading(true);
        setError('');
        void fetchSnapshotVersions(hallId, abort.signal).then(data => {
            if (abort.signal.aborted)
                return;
            setLoading(false);
            setVersions(data.versions);
            setActiveId(data.activeImportId);
            const latest = data.versions[0];
            setNewId(latest?.importId || '');
            setOldId(data.versions.find(item => item.versionNumber < (latest?.versionNumber || 0))?.importId || '');
        }).catch(error => { if (!abort.signal.aborted)
            setError(error instanceof Error ? error.message : t('compareLoadFailed')); })
            .finally(() => { if (!abort.signal.aborted)
            setLoading(false); });
        return () => abort.abort();
    }, [open, hallId, versions, retry]);
    const invalidate = () => { setResult(null); setError(''); setPage(1); setSearch(''); };
    const newVersion = versions?.find(item => item.importId === newId);
    const oldVersion = versions?.find(item => item.importId === oldId);
    const validPair = !!newVersion && !!oldVersion && oldVersion.versionNumber < newVersion.versionNumber;
    const run = async () => {
        if (!validPair)
            return;
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        invalidate();
        setBusy(true);
        try {
            const data = await compareSnapshots(hallId, oldId, newId, abort.signal);
            if (!abort.signal.aborted && mounted.current)
                setResult(data);
        }
        catch (error) {
            if (!abort.signal.aborted && mounted.current)
                setError(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (mounted.current && !abort.signal.aborted)
                setBusy(false);
        }
    };
    const download = async () => {
        if (!result)
            return;
        setExporting(true);
        setError('');
        try {
            const { downloadSnapshotComparison } = await import('../services/snapshotExport');
            await downloadSnapshotComparison(result, language);
        }
        catch (error) {
            if (mounted.current)
                setError(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (mounted.current)
                setExporting(false);
        }
    };
    const keyword = search.trim().toLocaleUpperCase();
    const locations = (result?.locations || []).filter(item => !keyword || item.locationCode.toLocaleUpperCase().includes(keyword)
        || item.changes.some(row => row.sku.toLocaleUpperCase().includes(keyword)));
    const pages = Math.max(1, Math.ceil(locations.length / PAGE_SIZE));
    const visible = locations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const label = (item: SnapshotVersion) => `V${item.versionNumber} · ${new Date(item.sourceExportedAt || item.importedAt).toLocaleString()}${item.importId === activeId ? ` · ${t('compareCurrentActive')}` : ''}`;
    return <details className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="list-none cursor-pointer p-4 flex items-center gap-3 hover:bg-slate-50">
      <span className="p-2 rounded-lg bg-blue-50 text-blue-600"><GitCompareArrows className="w-5 h-5"/></span>
      <span className="flex-1"><span className="block font-semibold text-slate-800">{t('compareTitle')}</span><span className="block text-xs text-slate-500 mt-1">{t('compareSubtitle')}</span></span>
      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}/>
    </summary>
    <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-4">
      {loading && <p role="status" className="text-sm text-slate-500">{t('compareLoading')}</p>}
      {versions && versions.length < 2 && <p className="text-sm text-slate-500">{t('compareNoVersions')}</p>}
      {versions && versions.length >= 2 && <>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <label className="text-slate-600">{t('compareOldVersion')}<select aria-label={t('compareOldVersion')} value={oldId} disabled={busy || exporting} onChange={event => { setOldId(event.target.value); invalidate(); }} className="block w-full mt-1 border border-slate-200 rounded-lg p-2 bg-slate-50">
            <option value="">—</option>{versions.map(item => <option key={item.importId} value={item.importId} disabled={!!newVersion && item.versionNumber >= newVersion.versionNumber}>{label(item)}</option>)}
          </select>{oldVersion && <span className="block mt-1 truncate" title={oldVersion.originalFilename}>{oldVersion.originalFilename}</span>}</label>
          <label className="text-slate-600">{t('compareNewVersion')}<select aria-label={t('compareNewVersion')} value={newId} disabled={busy || exporting} onChange={event => { setNewId(event.target.value); invalidate(); }} className="block w-full mt-1 border border-slate-200 rounded-lg p-2 bg-slate-50">
            {versions.map(item => <option key={item.importId} value={item.importId}>{label(item)}</option>)}
          </select>{newVersion && <span className="block mt-1 truncate" title={newVersion.originalFilename}>{newVersion.originalFilename}</span>}</label>
        </div>
        <button type="button" onClick={run} disabled={!validPair || busy || exporting} className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50">{busy ? t('compareLoading') : t('compareRun')}</button>
      </>}
      {error && <p role="alert" className="text-sm text-red-600">{error}{versions === null && !loading && <button type="button" className="ml-2 underline" onClick={() => { setRetry(value => value + 1); }}>{t('retry')}</button>}</p>}
      {result && <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-sm text-slate-600">{hallId} · V{result.oldVersion.versionNumber} → V{result.newVersion.versionNumber}</span>
          <button type="button" disabled={!result.locations.length || exporting} onClick={download} className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 disabled:opacity-50"><Download className="w-4 h-4"/>{t('compareDifferenceExport')}</button></div>
        {exporting && <p role="status" className="text-xs text-slate-500">{t('compareExporting')}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[[t('compareChangedLocations'), result.summary.changedLocations], [t('compareSkuChanges'), result.summary.changedSkuRows],
                [t('compareAdded'), result.summary.addedSkuRows], [t('compareRemoved'), result.summary.removedSkuRows]].map(([title, value]) => <div key={title} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2"><p className="text-xs text-slate-500">{title}</p><p className="text-lg font-semibold text-slate-800">{value}</p></div>)}
        </div>
        {!result.locations.length ? <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">{t('compareNoChanges')}</p> : <>
          <input aria-label={t('compareSearch')} placeholder={t('compareSearch')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="border border-slate-200 rounded-lg p-2 text-sm w-full"/>
          {!visible.length && <p className="text-sm text-slate-500">{t('compareNoSearchMatches')}</p>}
          {visible.map(location => <details key={`${oldId}:${newId}:${location.locationCode}`} className="border border-slate-200 rounded-lg overflow-hidden">
            <summary className="cursor-pointer px-3 py-3 bg-slate-50 flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold text-slate-800">{location.locationCode}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${location.changeType === 'NEW_LOCATION' ? 'bg-emerald-100 text-emerald-800' : location.changeType === 'EMPTIED_LOCATION' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{t(location.changeType === 'NEW_LOCATION' ? 'compareNewLocation' : location.changeType === 'EMPTIED_LOCATION' ? 'compareEmptiedLocation' : 'compareChangedLocation')}</span>
              <span className="text-xs text-slate-500 ml-auto">{location.oldTotalQty} → {location.newTotalQty} · {location.changes.length} SKU</span>
            </summary>
            <div className="p-3 space-y-3"><div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead className="text-slate-500 border-b border-slate-200"><tr><th className="py-2 pr-3">SKU</th><th className="p-2">{t('compareChangeType')}</th><th className="p-2 text-right">{t('compareOldQty')}</th><th className="p-2 text-right">{t('compareNewQty')}</th><th className="p-2 text-right">{t('compareDelta')}</th></tr></thead>
              <tbody>{location.changes.map(change => <tr key={change.sku} className="border-b border-slate-100 last:border-0"><td dir="ltr" className="py-2 pr-3 font-mono">{change.sku}</td><td className="p-2 text-slate-500">{t(change.changeType === 'ADDED' ? 'compareAdded' : change.changeType === 'REMOVED' ? 'compareRemoved' : 'compareQuantityChanged')}</td><td className="p-2 text-right tabular-nums">{change.oldQty}</td><td className="p-2 text-right tabular-nums">{change.newQty}</td><td className={`p-2 text-right font-semibold tabular-nums ${change.differenceQty > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{change.differenceQty > 0 ? '+' : ''}{change.differenceQty}</td></tr>)}</tbody>
            </table></div>
              {onInspectLocation && <button type="button" disabled={result.newVersion.importId !== activeId || exporting} onClick={() => onInspectLocation(location.locationCode)} className="text-xs border border-blue-200 rounded-lg text-blue-700 px-3 py-2 disabled:opacity-40">{t('compareReview')}</button>}
            </div>
          </details>)}
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className="border rounded-lg p-2 disabled:opacity-40">{t('comparePrev')}</button><span>{t('comparePageStatus', { page, pages, count: locations.length })}</span><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)} className="border rounded-lg p-2 disabled:opacity-40">{t('compareNext')}</button></div>
        </>}
        <p className="text-xs text-slate-500">{t('compareReviewHint')}</p>
      </div>}
    </div>
  </details>;
}
