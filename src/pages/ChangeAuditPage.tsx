import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, ScanLine, ChevronLeft, ChevronRight } from 'lucide-react';
import { isHandheldDevice } from '../utils/device';
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
import { auditId, createTask, listTasks, loadTask, managerStatus, unlockManager, lockManager, changeLifecycle } from '../changeAudit/api';
import type { TaskSummary } from '../changeAudit/api';
import { sessionFor } from '../changeAudit/session';
import type { AuditSession } from '../changeAudit/session';
const inputClass = 'border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm';
const buttonClass = 'border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-40';
const riskKeys = { multi: 'auditRiskMulti', similarCustomer: 'auditRiskCustomer', variant: 'auditRiskVariant', nearby: 'auditRiskNearby', move: 'auditRiskMove' } as const;
export function auditError(reason: string): string {
    if(['TASK_UNAVAILABLE','TASK_NOT_FOUND','PUBLICATION_CONFLICT'].includes(reason)) return t('auditUnavailable');
    if(['MANAGEMENT_REQUIRED','MANAGEMENT_DENIED','MANAGEMENT_NOT_CONFIGURED'].includes(reason)) return t('auditManageHint');
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
        return localStorage.getItem(key) || '';
    }
    catch {
        return '';
    }
}
function remember(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    }
    catch { window.dispatchEvent(new window.Event('wms-draft-storage-error')); }
}
export function ChangeAuditPage({ currentHall, active = true }: {
    currentHall: HallId;
    active?: boolean;
}) {
    const handheld=isHandheldDevice();
    const [quarantined,setQuarantined]=useState<AuditSession|null>(null);
    const [lifecycleBusy,setLifecycleBusy]=useState(false);
    const [archived,setArchived]=useState(false);
    const [manager,setManager]=useState(false), [credential,setCredential]=useState(''), [ready,setReady]=useState(false);
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
                { setError(auditError((e as Error).message)); if(['TASK_UNAVAILABLE','TASK_NOT_FOUND'].includes((e as Error).message)) {setSession(null);remember(taskKey,'');} }
        }
        finally {
            if (token === request.current && alive.current)
                setLoading(false);
        }
    };
    useEffect(() => {
        alive.current = true;
        const abort = new AbortController();
        void managerStatus().then(async access=> {
            if(abort.signal.aborted) return;
            const canManage=access.manager && !handheld; setManager(canManage); setReady(true);
            return Promise.all([canManage ? fetchSnapshotVersions(currentHall, abort.signal) : Promise.resolve(null), listTasks(currentHall, abort.signal)]);
        }).then(async response => {
            if(!response) return;
            const [metadata,list]=response;
            if (abort.signal.aborted)
                return;
            setVersions(metadata);
            setTasks(list.tasks);
            const selected = safeRead(taskKey);
            if(selected) await open(selected);
        }).catch(e => {
            if (!abort.signal.aborted)
                setError(auditError(e.message));
        }).finally(() => {
            if (!abort.signal.aborted)
                setLoading(false);
        });
        return () => { alive.current = false; abort.abort(); request.current++; };
    }, [currentHall]);
    useEffect(()=> {
        const refresh=()=>{if(!active || document.visibilityState==='hidden') return; void listTasks(currentHall,undefined,manager && archived).then(list=>{if(alive.current) setTasks(list.tasks);}).catch(()=>{}); if(session) void session.checkVersion(true);};
        const timer=setInterval(refresh,30000);
        window.addEventListener('focus',refresh);
        return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
    },[currentHall,active,session,manager,archived]);
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
            createToken.current=null;
        }
        catch (e) {
            if (alive.current)
                { setError(auditError((e as Error).message)); if(['TASK_UNAVAILABLE','TASK_NOT_FOUND'].includes((e as Error).message)) {setSession(null);remember(taskKey,'');} }
        }
        finally {
            if (alive.current)
                setCreating(false);
        }
    };
    const authorize=async () => { try { await unlockManager(credential); setCredential(''); window.location.reload(); } catch(e) {setError(auditError((e as Error).message));} };
    const lifecycle=async (status:string) => {
        if(!session || lifecycleBusy || (status==='DELETED' && !window.confirm(t('auditDeleteConfirm')))) return;
        setLifecycleBusy(true);setError('');
        try {
            await Promise.all([...session.drafts.keys()].map(code=>session.flush(code)));
            if(session.dirty && !window.confirm(t('auditUnsentChange'))) return;
            const state=await changeLifecycle(currentHall,session.task.id,status,session.task.publicationRevision || 0);
            session.task.lifecycle=state.lifecycle;session.task.publicationRevision=state.publicationRevision;
            if(session.dirty) session.unavailable=true;
            if(status==='DELETED') {if(session.dirty) setQuarantined(session);setSession(null);remember(taskKey,'');}
            else await open(session.task.id);
            setTasks((await listTasks(currentHall,undefined,archived)).tasks);
        } catch(e) {setError(auditError((e as Error).message));}
        finally {setLifecycleBusy(false);}
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
    const controls = <div className="space-y-3" data-audit-controls>
  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
   <h2 className="text-lg font-bold text-slate-800">{currentHall} · {t('auditMenu')}</h2>
   {!handheld && ready && !manager && <details><summary className="text-sm cursor-pointer">{t('auditManage')}</summary><p className="text-xs text-slate-500 py-2">{t('auditManageHint')}</p><input type="password" aria-label={t('auditManageKey')} autoComplete="off" className={inputClass} value={credential} onChange={e=>setCredential(e.target.value)}/><button type="button" className={buttonClass} disabled={!credential} onClick={()=>void authorize()}>{t('auditUnlock')}</button></details>}
   {manager && <><button className={buttonClass} onClick={()=>void lockManager().then(()=>window.location.reload())}>{t('auditLock')}</button><label className="text-xs block"><input type="checkbox" checked={archived} onChange={e=>{const value=e.target.checked;setArchived(value);void listTasks(currentHall,undefined,value).then(list=>setTasks(list.tasks));}}/> {t('auditArchive')}</label></>}
   <label className="block text-sm">{t('auditTasks')}<select aria-label={t('auditTasks')} className={`${inputClass} w-full mt-1`} disabled={loading || creating} value={session?.task.id || ''} onChange={e => {
            if (e.target.value)
                void open(e.target.value);
        }}><option value="">{t('auditChooseTask')}</option>{session && !tasks.some(task => task.id === session.task.id) && <option value={session.task.id}>{session.task.createdAt} · {session.task.id}</option>}{tasks.map(task => <option key={task.id} value={task.id}>{task.createdAt} · {t(('auditState'+(task.status || 'DRAFT')) as TranslationKey)} · {task.id.slice(-8)} · {versions?.versions.find(v => v.importId === task.oldId)?.versionNumber ?? '?'} → {versions?.versions.find(v => v.importId === task.newId)?.versionNumber ?? '?'}</option>)}</select></label>
   {session && <button type="button" className={`${buttonClass} text-slate-500`} disabled={session.busy} onClick={() => void reload()}>{t('auditReload')}</button>}
   {loading && <p role="status">{t('compareLoading')}</p>}
   {error && (!handheld || !session) && <p role="alert" className="text-sm text-red-600">{error}<button type="button" className="ml-2 underline" onClick={() => window.location.reload()}>{t('retry')}</button></p>}
  </div>
  {quarantined?.dirty && <div className="bg-amber-50 border rounded-xl p-3 text-xs space-y-2"><p>{t('auditUnavailableDraft')}</p><button className={buttonClass} disabled={quarantined.busy} onClick={()=>void quarantined.archiveDrafts().then(()=>{const id=quarantined.task.id;setQuarantined(null);return open(id);}).catch(e=>setError(auditError(e.message)))}>{t('auditArchiveDraft')}</button></div>}
  {manager && <details className="bg-white border border-slate-200 rounded-xl p-4" open={!session}>
   <summary className="font-semibold cursor-pointer">{t('compareTitle')} · {t('auditCreate')}</summary>
   <div className="space-y-3 pt-3">
    <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs">{t('auditStartRack')}<input aria-label={t('auditStartRack')} type="number" min="0" max="999" className={`${inputClass} block w-full mt-1`} value={config.startRack ?? ''} onChange={e => setConfig({ ...config, startRack: e.target.value === '' ? null : Number(e.target.value) })}/></label>
    <label className="text-xs">{t('auditStartEnd')}<select className={`${inputClass} block w-full mt-1`} value={config.startEnd} onChange={e => setConfig({ ...config, startEnd: e.target.value as RouteConfig['startEnd'] })}><option value="low">{t('auditLow')}</option><option value="high">{t('auditHigh')}</option></select></label></div>
    <label className="text-xs block">{t('auditPairs')}<textarea aria-label={t('auditPairs')} value={pairs} onChange={e => setPairs(e.target.value)} className={`${inputClass} block w-full mt-1 font-mono`} rows={2}/></label>
    <label className="text-xs">{t('exportLanguageLabel')} <select value={language} onChange={e => setLanguage(e.target.value as ExportLanguage)} className={inputClass}><option value="zh">中文</option><option value="en">English</option><option value="de">Deutsch</option></select></label>
    {versions && <SnapshotComparisonPanel key={currentHall} hallId={currentHall} language={language} initialVersions={versions} creating={creating} onStart={comparison => void start(comparison)}/>}
   </div>
  </details>}
  {manager && session && session.task.lifecycle!=='DELETED' && <div className="bg-white p-3 rounded-xl border flex flex-wrap gap-2 items-center"><span className="text-xs">{t(('auditState'+(session.task.lifecycle || 'DRAFT')) as TranslationKey)}</span>{session.task.lifecycle!=='PUBLISHED' && <button className={buttonClass} disabled={session.task.stale || lifecycleBusy} onClick={()=>void lifecycle('PUBLISHED')}>{t('auditPublish')}</button>}{session.task.lifecycle==='PUBLISHED' && <button className={buttonClass} disabled={lifecycleBusy} onClick={()=>void lifecycle('WITHDRAWN')}>{t('auditWithdraw')}</button>}<button className={`${buttonClass} text-red-700`} disabled={lifecycleBusy} onClick={()=>void lifecycle('DELETED')}>{t('auditDelete')}</button></div>}
 </div>;
    const workspace = session && <TaskWorkspace key={session.task.id} session={session} active={active} handheld={handheld} manager={manager} onUnavailable={()=>{if(session.dirty) setQuarantined(session);setSession(null);remember(taskKey,'');void listTasks(currentHall).then(list=>setTasks(list.tasks));setError(t('auditUnavailable'));}}/>;
    return <div className="max-w-2xl mx-auto px-2 sm:px-4 py-3 space-y-3 font-sans pb-24">
      {handheld && session && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {handheld && session ? <>{workspace}{controls}</> : <>{controls}{workspace}</>}
    </div>;
}
function TaskWorkspace({ session, active, manager, handheld, onUnavailable }: {
    handheld:boolean;
    manager:boolean;
    onUnavailable:()=>void;
    session: AuditSession;
    active: boolean;
}) {
    useSyncExternalStore(session.subscribe, session.snapshot);
    useEffect(()=> { if(session.unavailable && !(manager && ['DELETED','WITHDRAWN'].includes(session.task.lifecycle || ''))) onUnavailable(); },[session.unavailable]);
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
            if(handheld) window.scrollTo({top:0,left:0,behavior:'auto'});
        }
    }, [location, active, handheld]);
    const select = (code: string) => { void session.flush(location); setLocation(code); remember(locationKey, code); setManual(false); setScan(''); setScanError(''); };
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
    const previousCode = all[all.indexOf(location) - 1];
    const routeIndex = task.plan.route.indexOf(location);
    const remainingRoute = routeIndex < 0 ? task.plan.route : task.plan.route.slice(routeIndex + 1).concat(task.plan.route.slice(0, routeIndex));
    const nextCode = remainingRoute.find(code => session.drafts.get(code)?.dirty || !task.results[code]?.completed);
    const next = () => {
        if (nextCode)
            select(nextCode);
        else
            setScanError(t('auditAllDone'));
    };
    const list = all.filter(code => !search.trim() || code.includes(search.trim().toUpperCase()) || task.plan.targets.find(t => t.location === code)?.skus.some(s => s.sku.toUpperCase().includes(search.trim().toUpperCase())));
    const pages = Math.max(1, Math.ceil(list.length / 30)), done = all.filter(code => !session.drafts.get(code)?.dirty && task.results[code]?.completed).length;
    const status = (code: string): TranslationKey => !session.drafts.get(code)?.dirty && task.results[code]?.completed ? 'auditDone' : 'auditPending';
    const warnings = <>
      {handheld && draft?.error && <p role="alert" className="text-red-600 text-sm">{auditError(draft.error)}{draft.error!=='REVISION_CONFLICT' && !task.stale && !session.unavailable && <button type="button" className="underline ml-2" onClick={()=>void session.flush(location)}>{t('retry')}</button>}</p>}
   {session.unavailable && <p role="alert" className="text-red-700 text-sm">{t('auditUnavailableDraft')}<button className="underline ml-2" onClick={onUnavailable}>{t('auditBackTasks')}</button></p>}
   {task.lifecycle==='DELETED' && <p role="alert" className="text-red-700 text-sm">{t('auditStateDELETED')} · {t('auditTaskExport')}</p>}
   {task.lifecycle==='WITHDRAWN' && <p role="alert">{t('auditStateWITHDRAWN')}</p>}
   {task.stale && <p role="alert" className="text-amber-800 bg-amber-50 p-3 rounded-lg text-sm">{t('auditStale')}</p>}
   {session.storageError && <p role="alert" className="text-red-600 text-sm">{t('auditStorage')}</p>}
</>;
    const info = <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
   <p className="text-sm font-semibold">{t('auditCurrent')} {task.hall} · V{task.plan.comparison.oldVersion.versionNumber} → V{task.plan.comparison.newVersion.versionNumber}</p>
   <p className="text-xs text-slate-500">{t('auditProgress', { done, total: all.length })}</p>
   {!handheld && warnings}
   <div className="flex gap-2"><input aria-label={t('auditScanner')} ref={scanner} inputMode={manual ? 'text' : 'none'} value={scan} placeholder={t('auditScanner')} onChange={e => setScan(e.target.value)} onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                go();
            }
        }} className={`${inputClass} flex-1 min-w-0 font-mono`}/><button type="button" aria-label={t('auditManual')} onClick={keyboard} className="rounded-full border p-2"><Keyboard className="w-5 h-5"/></button><button type="button" onClick={go} className={buttonClass}><ScanLine className="w-5 h-5"/></button></div>
   {scanError && <p role="alert" className="text-amber-800 text-sm">{scanError}</p>}
  </div>;
    const routePanel = <details className="bg-white p-4 rounded-xl border border-slate-200"><summary className="font-semibold cursor-pointer">{t('auditRoute')} · {task.plan.route.length} / {all.length}</summary>
   <input aria-label={t('compareSearch')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder={t('compareSearch')} className={`${inputClass} w-full`}/>
   <div className="space-y-1 mt-2">{list.slice((page - 1) * 30, page * 30).map(code => {
            const entry = task.plan.targets.find(t => t.location === code)!;
            return <button type="button" key={code} onClick={() => select(code)} className={`w-full text-left rounded-lg border px-3 py-2 flex flex-wrap gap-2 text-xs ${code === location ? 'border-blue-400 bg-blue-50' : 'border-slate-100'}`}><span className="font-mono font-bold">{code}</span><span>{t(categoryKey(entry))}</span>{task.plan.special.includes(code) && <span className="text-amber-700">{t('auditSpecial')}</span>}<span className="ml-auto">{t(status(code))}{task.results[code]?.anomaly ? ' · ' + t('auditAnomaly') : ''}</span></button>;
        })}</div><div className="flex justify-between items-center mt-2"><button type="button" className={buttonClass} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('comparePrev')}</button><span className="text-xs">{page}/{pages}</span><button type="button" className={buttonClass} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>{t('compareNext')}</button></div>
  </details>;
    const locationContext = target && result && <>
   <div className="flex flex-wrap justify-between items-center gap-2"><span className="text-xs text-blue-800 bg-blue-50 px-3 py-1 rounded-full">{t(categoryKey(target))}</span></div>
   <p className="text-sm text-slate-500">{t(status(location))}{isAnomaly(target, result) ? ' · ' + t('auditAnomaly') : ''}</p>
   {target.risks.length ? <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-900 space-y-2">{target.risks.map((risk, i) => <p key={i}>{t(riskKeys[risk.kind], risk.params)}</p>)}</div> : null}
    </>;
    const inspection = !target || !result ? <p>{t('auditTaskEmpty')}</p> : <section className="space-y-2.5">
   {!handheld && locationContext}
   <TaskInspectionEditor active={active} context={handheld ? locationContext : undefined} navigation={<nav aria-label={t('auditRoute')} className="grid grid-cols-2 gap-2">
     <button type="button" aria-label={t('auditPrev')} disabled={!previousCode} onClick={() => previousCode && select(previousCode)} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm disabled:opacity-40">
      <span className="flex items-center gap-1 text-xs text-slate-500"><ChevronLeft className="w-4 h-4"/>{t('auditPrev')}</span>
      <span className="mt-1 block font-mono text-base sm:text-lg font-semibold text-slate-800">{previousCode || t('auditNoPrevious')}</span>
     </button>
     <button type="button" aria-label={t('auditNext')} disabled={!nextCode} onClick={next} className="min-w-0 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-right shadow-sm disabled:opacity-40">
      <span className="flex items-center justify-end gap-1 text-xs text-blue-700">{t('auditNext')}<ChevronRight className="w-4 h-4"/></span>
      <span className="mt-1 block font-mono text-base sm:text-lg font-semibold text-blue-900">{nextCode || t('auditNoNext')}</span>
     </button>
    </nav>} key={location} session={session} target={target} result={result} disabled={task.stale || session.unavailable || (task.lifecycle==='WITHDRAWN' || task.lifecycle==='DELETED') || draft?.error === 'REVISION_CONFLICT'}/>
   <div role="status" className={`text-sm ${draft?.error ? 'text-red-600' : 'text-slate-500'}`}>{draft?.error ? auditError(draft.error) : draft?.saving ? t('auditSaving') : draft?.dirty ? t('auditSavePending') : task.results[location]?.savedAt ? `${t('saved')} · ${new Date(task.results[location].savedAt!).toLocaleTimeString()}` : t('auditUnsaved')}
    {draft?.error && draft.error !== 'REVISION_CONFLICT' && !task.stale && <button type="button" className="ml-2 underline" onClick={() => void session.flush(location)}>{t('retry')}</button>}</div>
   <details className="text-xs text-slate-500"><summary className="cursor-pointer">{t('auditCompareDetails')}</summary>{target.changes.map(change => <p className="font-mono py-1" key={change.sku}>{change.sku}: {change.oldQty} → {change.newQty} ({change.differenceQty > 0 ? '+' : ''}{change.differenceQty})</p>)}</details>

  </section>;
    return <div className="space-y-3" data-audit-workspace>
      {handheld ? <>{warnings}{inspection}{info}{routePanel}</> : <>{info}{routePanel}{inspection}</>}
      {manager && <TaskResultExport session={session}/>}
    </div>;
}
