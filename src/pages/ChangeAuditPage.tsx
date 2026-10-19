import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, ScanLine, ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '../i18n';
import { registerLanguageSafety } from '../i18n/safety';
import type { TranslationKey } from '../i18n/zh';
import type { HallId, SnapshotComparison, SnapshotVersion } from '../types';
import type { ExportLanguage } from '../services/exportLanguage';
import { fetchSnapshotVersions } from '../services/snapshotCompare';
import { SnapshotComparisonPanel } from '../components/SnapshotComparisonPanel';
import { TaskInspectionEditor } from '../changeAudit/TaskInspectionEditor';
import { TaskResultExport } from '../changeAudit/TaskResultExport';
import { defaultRoute, isAnomaly } from '../changeAudit/model';
import type { RouteConfig, Target } from '../changeAudit/model';
import { auditId, createTask, listTasks, loadTask } from '../changeAudit/api';
import type { TaskSummary } from '../changeAudit/api';
import { sessionFor } from '../changeAudit/session';
import type { AuditSession } from '../changeAudit/session';
const inputClass = 'border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm';
const buttonClass = 'border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-40';
const riskKeys = { multi: 'auditRiskMulti', similarCustomer: 'auditRiskCustomer', variant: 'auditRiskVariant', nearby: 'auditRiskNearby', move: 'auditRiskMove' } as const;
export function auditError(reason: string): string {
    if (reason === 'STALE_VERSION')
        return t('auditStale');
    if (reason === 'REVISION_CONFLICT')
        return t('auditConflict');
    if (reason === 'INVALID_ROUTE' || reason === 'INVALID_START')
        return t('auditInvalidRoute');
    if (['INCOMPLETE_COUNTS', 'CONFIRM_EMPTY', 'IDENTIFY_EXTRA'].includes(reason))
        return t('auditIncomplete');
    return t('auditError', { reason });
}
const categoryKey = (target: Target) => target.category === 'NEW_LOCATION' ? 'compareNewLocation' : target.category === 'EMPTIED_LOCATION' ? 'compareEmptiedLocation' : 'compareChangedLocation';
function safeRead(key: string): string {
    try {
        return sessionStorage.getItem(key) || '';
    }
    catch {
        return '';
    }
}
function remember(key: string, value: string) {
    try {
        sessionStorage.setItem(key, value);
    }
    catch { /* Server data does not depend on browser preferences. */ }
}
export function ChangeAuditPage({ currentHall, active = true }: {
    currentHall: HallId;
    active?: boolean;
}) {
    const [versions, setVersions] = useState<{
        versions: SnapshotVersion[];
        activeImportId: string | null;
    } | null>(null);
    const [tasks, setTasks] = useState<TaskSummary[]>([]), [session, setSession] = useState<AuditSession | null>(null);
    const [error, setError] = useState(''), [loading, setLoading] = useState(true), [creating, setCreating] = useState(false);
    const [config, setConfig] = useState<RouteConfig>(defaultRoute), [pairs, setPairs] = useState(''), [language, setLanguage] = useState<ExportLanguage>('zh');
    const request = useRef(0), alive = useRef(true), createToken = useRef<{
        signature: string;
        id: string;
    } | null>(null);
    const taskKey = `wms-change-audit-selected:${currentHall}`;
    const open = async (id: string) => {
        const token = ++request.current;
        setLoading(true);
        setError('');
        try {
            const task = await loadTask(currentHall, id);
            if (token !== request.current || !alive.current)
                return;
            setSession(sessionFor(task));
            remember(taskKey, id);
        }
        catch (e) {
            if (token === request.current && alive.current)
                setError(auditError((e as Error).message));
        }
        finally {
            if (token === request.current && alive.current)
                setLoading(false);
        }
    };
    useEffect(() => {
        alive.current = true;
        const abort = new AbortController();
        void Promise.all([fetchSnapshotVersions(currentHall, abort.signal), listTasks(currentHall, abort.signal)]).then(async ([metadata, list]) => {
            if (abort.signal.aborted)
                return;
            setVersions(metadata);
            setTasks(list.tasks);
            const selected = safeRead(taskKey);
            if (selected)
                await open(selected);
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(auditError(e.message));
        }).finally(() => {
            if (!abort.signal.aborted)
                setLoading(false);
        });
        return () => { alive.current = false; abort.abort(); request.current++; };
    }, [currentHall]);
    const start = async (comparison: SnapshotComparison) => {
        setCreating(true);
        setError('');
        try {
            const custom = pairs.trim() ? pairs.trim().split(/\n/).map(line => {
                if (!/^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/.test(line))
                    throw new Error('INVALID_ROUTE');
                return line.split('/').map(Number);
            }) : [];
            const payload = { oldId: comparison.oldVersion.importId, newId: comparison.newVersion.importId, config: { ...config, pairs: custom } };
            const signature = JSON.stringify(payload);
            if (createToken.current?.signature !== signature)
                createToken.current = { signature, id: auditId() };
            const saved = await createTask(currentHall, { ...payload, id: createToken.current!.id });
            if (!alive.current)
                return;
            if (saved.task) {
                setSession(sessionFor(saved.task));
                remember(taskKey, saved.id);
            }
            else
                await open(saved.id);
            if (alive.current)
                setTasks(previous => previous.some(task => task.id === saved.id) ? previous : [{ id: saved.id, oldId: payload.oldId, newId: payload.newId, createdAt: saved.task?.createdAt || new Date().toISOString() }, ...previous].slice(0, 100));
        }
        catch (e) {
            if (alive.current)
                setError(auditError((e as Error).message));
        }
        finally {
            if (alive.current)
                setCreating(false);
        }
    };
    const reload = async () => {
        if (!session)
            return;
        if (session.dirty && !window.confirm(t('auditDiscard')))
            return;
        try {
            await session.discard();
            await open(session.task.id);
        }
        catch (e) {
            setError(auditError((e as Error).message));
        }
    };
    return <div className="max-w-2xl mx-auto px-2 sm:px-4 py-3 space-y-3 font-sans pb-24">
  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
   <h2 className="text-lg font-bold text-slate-800">{currentHall} · {t('auditMenu')}</h2><p className="text-xs text-slate-500">{t('auditIntro')}</p>
   <label className="block text-sm">{t('auditTasks')}<select aria-label={t('auditTasks')} className={`${inputClass} w-full mt-1`} disabled={loading || creating} value={session?.task.id || ''} onChange={e => {
            if (e.target.value)
                void open(e.target.value);
        }}><option value="">{t('auditChooseTask')}</option>{session && !tasks.some(task => task.id === session.task.id) && <option value={session.task.id}>{session.task.createdAt} · {session.task.id}</option>}{tasks.map(task => <option key={task.id} value={task.id}>{task.createdAt} · {task.id.slice(-8)} · {versions?.versions.find(v => v.importId === task.oldId)?.versionNumber ?? '?'} → {versions?.versions.find(v => v.importId === task.newId)?.versionNumber ?? '?'}</option>)}</select></label>
   {session && <button type="button" className={`${buttonClass} text-slate-500`} disabled={session.busy} onClick={() => void reload()}>{t('auditReload')}</button>}
   {loading && <p role="status">{t('compareLoading')}</p>}
   {error && <p role="alert" className="text-sm text-red-600">{error}<button type="button" className="ml-2 underline" onClick={() => window.location.reload()}>{t('retry')}</button></p>}
  </div>
  <details className="bg-white border border-slate-200 rounded-xl p-4" open={!session}>
   <summary className="font-semibold cursor-pointer">{t('compareTitle')} · {t('auditCreate')}</summary>
   <div className="space-y-3 pt-3">
    <p className="text-xs text-slate-500">{t('auditRouteHint')}</p>
    <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs">{t('auditStartRack')}<input aria-label={t('auditStartRack')} type="number" min="0" max="999" className={`${inputClass} block w-full mt-1`} value={config.startRack ?? ''} onChange={e => setConfig({ ...config, startRack: e.target.value === '' ? null : Number(e.target.value) })}/></label>
    <label className="text-xs">{t('auditStartEnd')}<select className={`${inputClass} block w-full mt-1`} value={config.startEnd} onChange={e => setConfig({ ...config, startEnd: e.target.value as RouteConfig['startEnd'] })}><option value="low">{t('auditLow')}</option><option value="high">{t('auditHigh')}</option></select></label></div>
    <label className="text-xs block">{t('auditPairs')}<textarea aria-label={t('auditPairs')} value={pairs} onChange={e => setPairs(e.target.value)} className={`${inputClass} block w-full mt-1 font-mono`} rows={2}/></label>
    <label className="text-xs">{t('exportLanguageLabel')} <select value={language} onChange={e => setLanguage(e.target.value as ExportLanguage)} className={inputClass}><option value="zh">中文</option><option value="en">English</option><option value="de">Deutsch</option></select></label>
    {versions && <SnapshotComparisonPanel key={currentHall} hallId={currentHall} language={language} initialVersions={versions} creating={creating} onStart={comparison => void start(comparison)}/>}
   </div>
  </details>
  {session && <TaskWorkspace key={session.task.id} session={session} active={active}/>}
 </div>;
}
function TaskWorkspace({ session, active }: {
    session: AuditSession;
    active: boolean;
}) {
    useSyncExternalStore(session.subscribe, session.snapshot);
    const task = session.task, all = [...task.plan.route, ...task.plan.special];
    const previouslyActive = useRef(active);
    useEffect(() => {
        if (active && !previouslyActive.current)
            void session.checkVersion(true);
        previouslyActive.current = active;
    }, [active, session]);
    const locationKey = `wms-change-audit-location:${task.id}`;
    const [location, setLocation] = useState(() => { const remembered = safeRead(locationKey); return all.includes(remembered) ? remembered : task.plan.route.find(code => !task.results[code]?.completed) || all[0] || ''; });
    const [search, setSearch] = useState(''), [page, setPage] = useState(1), [scan, setScan] = useState(''), [manual, setManual] = useState(false), [scanError, setScanError] = useState('');
    const scanner = useRef<HTMLInputElement>(null);
    const target = task.plan.targets.find(t => t.location === location), result = target ? session.result(location) : null;
    const draft = session.drafts.get(location);
    useEffect(() => registerLanguageSafety(`change-audit:${task.id}`, { dirty: () => session.dirty, busy: () => session.busy }), [session]);
    useEffect(() => {
        const check = () => {
            if (active && document.visibilityState !== 'hidden')
                void session.checkVersion();
        };
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);
        return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
    }, [session, active]);
    useEffect(() => {
        const input = scanner.current;
        if (active && input) {
            setManual(false);
            input.blur();
            input.inputMode = 'none';
            input.focus({ preventScroll: true });
        }
    }, [location, active]);
    const select = (code: string) => { setLocation(code); remember(locationKey, code); setManual(false); setScan(''); setScanError(''); };
    const go = () => {
        const code = scan.trim().toUpperCase();
        if (all.includes(code))
            select(code);
        else
            setScanError(t('auditNotTarget'));
    };
    const keyboard = () => {
        const input = scanner.current;
        if (!input)
            return;
        input.blur();
        const next = !manual;
        input.inputMode = next ? 'text' : 'none';
        setManual(next);
        input.focus({ preventScroll: true });
    };
    const next = () => {
        const route = task.plan.route, index = route.indexOf(location);
        const ordered = index < 0 ? route : route.slice(index + 1).concat(route.slice(0, index));
        const nextCode = ordered.find(code => session.drafts.get(code)?.dirty || !task.results[code]?.completed);
        if (nextCode)
            select(nextCode);
        else
            setScanError(t('auditAllDone'));
    };
    const list = all.filter(code => !search.trim() || code.includes(search.trim().toUpperCase()) || task.plan.targets.find(t => t.location === code)?.skus.some(s => s.sku.toUpperCase().includes(search.trim().toUpperCase())));
    const pages = Math.max(1, Math.ceil(list.length / 30)), done = all.filter(code => !session.drafts.get(code)?.dirty && task.results[code]?.completed).length;
    const status = (code: string): TranslationKey => !session.drafts.get(code)?.dirty && task.results[code]?.completed ? 'auditDone' : 'auditPending';
    return <div className="space-y-3">
  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
   <p className="text-sm font-semibold">{t('auditCurrent')} {task.hall} · V{task.plan.comparison.oldVersion.versionNumber} → V{task.plan.comparison.newVersion.versionNumber}</p>
   <p className="text-xs text-slate-500">{t('auditProgress', { done, total: all.length })}</p>
   {task.stale && <p role="alert" className="text-amber-800 bg-amber-50 p-3 rounded-lg text-sm">{t('auditStale')}</p>}
   {session.storageError && <p role="alert" className="text-red-600 text-sm">{t('auditStorage')}</p>}
   <div className="flex gap-2"><input aria-label={t('auditScanner')} ref={scanner} inputMode={manual ? 'text' : 'none'} value={scan} placeholder={t('auditScanner')} onChange={e => setScan(e.target.value)} onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                go();
            }
        }} className={`${inputClass} flex-1 min-w-0 font-mono`}/><button type="button" aria-label={t('auditManual')} onClick={keyboard} className="rounded-full border p-2"><Keyboard className="w-5 h-5"/></button><button type="button" onClick={go} className={buttonClass}><ScanLine className="w-5 h-5"/></button></div>
   {scanError && <p role="alert" className="text-amber-800 text-sm">{scanError}</p>}
  </div>
  <details className="bg-white p-4 rounded-xl border border-slate-200"><summary className="font-semibold cursor-pointer">{t('auditRoute')} · {task.plan.route.length} / {all.length}</summary>
   <p className="text-xs text-slate-500 py-2">{t('auditRouteHint')} {t('auditOrdinary')}</p>
   <input aria-label={t('compareSearch')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder={t('compareSearch')} className={`${inputClass} w-full`}/>
   <div className="space-y-1 mt-2">{list.slice((page - 1) * 30, page * 30).map(code => {
            const entry = task.plan.targets.find(t => t.location === code)!;
            return <button type="button" key={code} onClick={() => select(code)} className={`w-full text-left rounded-lg border px-3 py-2 flex flex-wrap gap-2 text-xs ${code === location ? 'border-blue-400 bg-blue-50' : 'border-slate-100'}`}><span className="font-mono font-bold">{code}</span><span>{t(categoryKey(entry))}</span>{task.plan.special.includes(code) && <span className="text-amber-700">{t('auditSpecial')}</span>}<span className="ml-auto">{t(status(code))}{task.results[code]?.anomaly ? ' · ' + t('auditAnomaly') : ''}</span></button>;
        })}</div><div className="flex justify-between items-center mt-2"><button type="button" className={buttonClass} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('comparePrev')}</button><span className="text-xs">{page}/{pages}</span><button type="button" className={buttonClass} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>{t('compareNext')}</button></div>
  </details>
  {!target || !result ? <p>{t('auditTaskEmpty')}</p> : <section className="space-y-2.5">
   <div className="flex flex-wrap justify-between items-center gap-2"><span className="text-xs text-blue-800 bg-blue-50 px-3 py-1 rounded-full">{t(categoryKey(target))}</span></div>
   <p className="text-sm text-slate-500">{t(status(location))}{isAnomaly(target, result) ? ' · ' + t('auditAnomaly') : ''}</p>
   {target.risks.length ? <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-900 space-y-2"><p className="font-medium">{t('auditFocused')}</p>{target.risks.map((risk, i) => <p key={i}>{t(riskKeys[risk.kind], risk.params)}</p>)}</div> : <p className="text-xs text-slate-500">{t('auditOrdinary')}</p>}
   <TaskInspectionEditor key={location} session={session} target={target} result={result} disabled={task.stale || draft?.error === 'REVISION_CONFLICT'}/>
   <div role="status" className={`text-sm ${draft?.error ? 'text-red-600' : 'text-slate-500'}`}>{draft?.error ? auditError(draft.error) : draft?.saving ? t('auditSaving') : draft?.dirty ? t('auditSavePending') : task.results[location]?.savedAt ? `${t('saved')} · ${new Date(task.results[location].savedAt!).toLocaleTimeString()}` : t('auditUnsaved')}
    {draft?.error && draft.error !== 'REVISION_CONFLICT' && !task.stale && <button type="button" className="ml-2 underline" onClick={() => void session.flush(location)}>{t('retry')}</button>}</div>
   <details className="text-xs text-slate-500"><summary className="cursor-pointer">{t('auditCompareDetails')}</summary>{target.changes.map(change => <p className="font-mono py-1" key={change.sku}>{change.sku}: {change.oldQty} → {change.newQty} ({change.differenceQty > 0 ? '+' : ''}{change.differenceQty})</p>)}</details>
   <div className="flex justify-between gap-2"><button type="button" className={`${buttonClass} flex gap-1 items-center`} disabled={all.indexOf(location) <= 0} onClick={() => select(all[all.indexOf(location) - 1])}><ChevronLeft className="w-4 h-4"/>{t('auditPrev')}</button><button type="button" className={`${buttonClass} flex gap-1 items-center`} onClick={next}>{t('auditNext')}<ChevronRight className="w-4 h-4"/></button></div>
  </section>}
  <TaskResultExport session={session}/>
 </div>;
}
