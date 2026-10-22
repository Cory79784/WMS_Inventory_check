import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Keyboard} from 'lucide-react';
import {t} from '../i18n';
import {isHandheldDevice} from '../utils/device';
import {registerLanguageSafety} from '../i18n/safety';
import type {HallId} from '../types';
import {TaskInspectionEditor} from '../changeAudit/TaskInspectionEditor';
import {auditId} from '../changeAudit/api';
import type {AuditSession} from '../changeAudit/session';
import {countSession,forgetCountSession} from '../skuCount/session';
import {listCountScopes,listCountTasks,loadCountTask,countManager,authorizeCountManager,lockCountManager,createCountTask,countControl,type CountSummary} from '../skuCount/api';
import type {CountTask,CountRow} from '../skuCount/model';
import {areaScope,isReturnArea,validScope,orderedScopes,scopeLabel,mainHalls} from '../skuCount/areas';
import {readCountFile} from '../skuCount/import';
const field='border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const button='border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-40';
let sourceCache:{rows:CountRow[];file:string;hash:string}|null=null;
function read(key:string){try{return localStorage.getItem(key)||'';}catch{return '';}}
function remember(key:string,value:string){try{localStorage.setItem(key,value);}catch{window.dispatchEvent(new window.Event('wms-draft-storage-error'));}}
function message(error:unknown){const code=error instanceof Error?error.message:String(error);if(['TASK_CLAIMED','CLAIM_REQUIRED'].includes(code))return t('skuClaimRequired');if(['TASK_UNAVAILABLE','PUBLICATION_CONFLICT'].includes(code))return t('skuTaskChanged');if(/^INVALID_(ROW|QUANTITY):/.test(code))return t(code.startsWith('INVALID_QUANTITY')?'skuInvalidQuantity':'skuInvalidRow',{row:code.split(':')[1]});if(code==='PHOTO_REQUIRED')return t('skuWrongPhoto');return t('auditError',{reason:code});}
export function SkuCountPage({currentHall,active=true,onSelectHall}:{currentHall:HallId;active?:boolean;onSelectHall?:(hall:HallId)=>void}){
 const [scope,setScope]=useState(()=>{const saved=read(`wms-sku-count-scope:${currentHall}`);return validScope(saved)&&(!mainHalls.some(h=>h===saved)||saved===currentHall)?saved:currentHall;});
 const [knownScopes,setKnownScopes]=useState<string[]>([]);
 const scopeName=scopeLabel(scope,t('skuSmallGoods'));
 const chooseScope=(next:string)=>{
  if(!validScope(next))return;
  if(mainHalls.some(h=>h===next)&&next!==currentHall&&onSelectHall){remember(`wms-sku-count-scope:${next}`,next);onSelectHall(next as HallId);return;}
  request.current++;setSession(null);setTasks([]);setScope(next);remember(`wms-sku-count-scope:${currentHall}`,next);
 };
 useEffect(()=>{void listCountScopes().then(data=>setKnownScopes(data.scopes)).catch(()=>{});},[]);
 const mobile=isHandheldDevice();
 const [manager,setManager]=useState(false),[key,setKey]=useState(''),[tasks,setTasks]=useState<CountSummary[]>([]),[session,setSession]=useState<AuditSession<CountTask>|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[source,setSource]=useState(sourceCache),[selected,setSelected]=useState<string[]>([]),[name,setName]=useState(''),[search,setSearch]=useState(''),[archived,setArchived]=useState(false);
 const [operator,setOperator]=useState(()=>read('wms-sku-count-operator'));
 const request=useRef(0),alive=useRef(true),creating=useRef<{signature:string;id:string}|null>(null);
 const allSkus=[...new Set(source?.rows.filter(r=>!isReturnArea(r.hall)&&areaScope(r.hall)===scope).map(r=>r.sku)||[])].sort();
 useEffect(()=>setSelected(allSkus),[source,scope]);
 const open=async(id:string)=>{const sequence=++request.current;setError('');setBusy(true);try{const task=await loadCountTask(scope,id);if(!alive.current||sequence!==request.current)return;setSession(countSession(task));remember(`wms-sku-count-selected:${scope}`,id);}catch(e){if(alive.current&&sequence===request.current){setError(message(e));setSession(null);remember(`wms-sku-count-selected:${scope}`,'');}}finally{if(alive.current&&sequence===request.current)setBusy(false);}};
 const refresh=async()=>{const generation=request.current;const data=await listCountTasks(scope,undefined,manager&&archived);if(alive.current&&generation===request.current)setTasks(data.tasks);};
 useEffect(()=>{alive.current=true;const abort=new AbortController();void Promise.all([countManager(),listCountTasks(scope,abort.signal)]).then(async([access,list])=>{if(abort.signal.aborted)return;setManager(access.manager&&!mobile);setTasks(list.tasks);const id=read(`wms-sku-count-selected:${scope}`);if(id)await open(id);}).catch(e=>{if(!abort.signal.aborted)setError(message(e));});return()=>{alive.current=false;request.current++;abort.abort();};},[scope]);
 useEffect(()=>{const check=()=>{if(!active||document.visibilityState==='hidden')return;void refresh().catch(()=>{});void listCountScopes().then(data=>{if(alive.current)setKnownScopes(data.scopes);}).catch(()=>{});if(session)void session.checkVersion(true);};const timer=setInterval(check,30000);window.addEventListener('focus',check);return()=>{clearInterval(timer);window.removeEventListener('focus',check);};},[scope,active,manager,archived,session]);
 const control=async(action:'claim'|'release'|'lifecycle',status?:string)=>{
  if(!session||busy)return;
  if(action==='claim'&&!operator.trim()){setError(t('skuEnterName'));return;}
  if(status==='DELETED'&&!window.confirm(t('skuDeleteConfirm')))return;
  setBusy(true);setError('');
  try{
   await Promise.all([...session.drafts.keys()].map(code=>session.flush(code)));
   if(session.dirty){setError(t('skuDraftBeforeControl'));return;}
   await countControl(scope,session.task.id,action,{revision:session.task.publicationRevision,...(action==='claim'?{name:operator.trim()}:{}),...(status?{status}:{})});
   remember('wms-sku-count-operator',operator.trim());forgetCountSession(session.task.id);
   if(status==='DELETED'){setSession(null);remember(`wms-sku-count-selected:${scope}`,'');}else await open(session.task.id);
   await refresh();
  }catch(e){setError(message(e));}finally{setBusy(false);}
 };
 const upload=async(file:File)=>{setBusy(true);setError('');setSource(null);sourceCache=null;setSelected([]);try{const parsed=await readCountFile(file);sourceCache=parsed;setSource(parsed);creating.current=null;}catch(e){setError(message(e));}finally{setBusy(false);}};
 const create=async()=>{if(!source)return;setBusy(true);setError('');try{
  const payload={name:name.trim(),rows:source.rows.filter(r=>selected.includes(r.sku)&&(isReturnArea(r.hall)||areaScope(r.hall)===scope)),skus:selected,sourceFile:source.file,sourceHash:source.hash};
  const signature=JSON.stringify(payload);if(creating.current?.signature!==signature)creating.current={id:auditId(),signature};
  const result=await createCountTask(scope,{id:creating.current.id,...payload});creating.current=null;await open(result.id);await refresh();
 }catch(e){setError(message(e));}finally{setBusy(false);}};
 const management=<div className="space-y-3" data-sku-controls>
  <div className="bg-white border rounded-xl p-3 space-y-2"><h2 className="font-semibold">{scopeName} · {t('skuMenu')}</h2>
   <label className="text-sm block">{t('skuAreaGroup')}<select aria-label={t('skuAreaGroup')} className={`${field} w-full`} value={scope} disabled={busy} onChange={e=>chooseScope(e.target.value)}>{orderedScopes([...knownScopes,scope,...(source?.rows.filter(r=>!isReturnArea(r.hall)).map(r=>areaScope(r.hall))||[])]).map(id=><option key={id} value={id}>{scopeLabel(id,t('skuSmallGoods'))}</option>)}</select></label>
   {!mobile&&!manager&&<details><summary>{t('auditManage')}</summary><p className="text-xs text-slate-500">{t('auditManageHint')}</p><input type="password" aria-label={t('auditManageKey')} className={field} value={key} onChange={e=>setKey(e.target.value)}/><button className={button} disabled={busy||!key} onClick={()=>void authorizeCountManager(key).then(()=>{setKey('');setManager(true);return refresh();}).catch(e=>setError(message(e)))}>{t('auditUnlock')}</button></details>}
   {manager&&<button className={button} onClick={()=>void lockCountManager().then(()=>{setManager(false);return refresh();})}>{t('auditLock')}</button>}
   <label className="text-sm block">{t('skuTasks')}<select aria-label={t('skuTasks')} className={`${field} w-full`} value={session?.task.id||''} disabled={busy} onChange={e=>{if(e.target.value)void open(e.target.value);}}><option value="">{t('auditChooseTask')}</option>{session&&!tasks.some(task=>task.id===session.task.id)&&<option value={session.task.id}>{session.task.name}</option>}{tasks.map(task=><option key={task.id} value={task.id}>{task.name} · {task.completed}/{task.total} · {task.claimedBy||t('skuUnclaimed')} · {t(('auditState'+task.lifecycle) as 'auditStateDRAFT')}</option>)}</select></label>
   {manager&&<label className="text-xs block"><input type="checkbox" checked={archived} onChange={e=>{setArchived(e.target.checked);void listCountTasks(scope,undefined,e.target.checked).then(list=>setTasks(list.tasks));}}/> {t('skuArchive')}</label>}
   <p className="text-xs text-slate-500">{t('skuOwnScope')}</p>
  </div>
  {manager&&!mobile&&<details open={!session} className="bg-white border rounded-xl p-3 space-y-3"><summary className="font-semibold">{t('skuCreate')}</summary>
   <input type="file" aria-label={t('skuImport')} accept=".xlsx" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/>
   {source&&<><p className="text-xs break-all">{source.file}</p><p className="text-xs">{t('skuSourceRows',{rows:source.rows.length})}</p>
    <SourceAreas rows={source.rows}/>
    <input aria-label={t('skuTaskName')} placeholder={t('skuTaskName')} value={name} maxLength={100} onChange={e=>setName(e.target.value)} className={`${field} w-full`}/>
    <p className="text-xs">{t('skuSelectScope',{hall:scopeName,skus:selected.length,locations:new Set(source.rows.filter(r=>!isReturnArea(r.hall)&&areaScope(r.hall)===scope&&selected.includes(r.sku)).map(r=>JSON.stringify([r.hall.toUpperCase(),r.location]))).size})}</p>
    <input aria-label={t('compareSearch')} placeholder={t('compareSearch')} value={search} onChange={e=>setSearch(e.target.value)} className={`${field} w-full`}/>
    <div className="flex gap-2"><button className={button} onClick={()=>setSelected(allSkus)}>{t('skuSelectAll')}</button><button className={button} onClick={()=>setSelected([])}>{t('skuClear')}</button></div>
    <div className="max-h-52 overflow-y-auto space-y-1">{allSkus.filter(s=>s.toLowerCase().includes(search.toLowerCase())).map(s=><label key={s} className="block text-xs font-mono"><input type="checkbox" checked={selected.includes(s)} onChange={e=>setSelected(list=>e.target.checked?[...list,s]:list.filter(v=>v!==s))}/> {s}</label>)}</div>
    <button className={`${button} text-blue-700`} disabled={busy||!name.trim()||!selected.length} onClick={()=>void create()}>{t('skuCreateDraft')}</button>
   </>}
  </details>}
  {session&&<div className="bg-white border rounded-xl p-3 space-y-2 text-xs"><p className="font-semibold">{session.task.name}</p><p className="break-all">{t('skuSource')}: {session.task.plan.sourceFile}</p><p className="break-all">{t('skuTaskId')}: {session.task.id}</p><p>{t('skuScopeSummary',{skus:session.task.plan.skus.length,locations:session.task.plan.route.length})}</p>
   {!!session.task.plan.excludedReturns?.length&&<SourceAreas rows={session.task.plan.excludedReturns} returnsOnly/>}
   <p>{t('skuOwner')}: {session.task.claimedBy||t('skuUnclaimed')}</p>
   {(manager||session.task.mine)&&session.task.claimedBy&&session.task.lifecycle!=='DELETED'&&<button className={button} disabled={busy} onClick={()=>void control('release')}>{t('skuRelease')}</button>}
   {manager&&session.task.lifecycle!=='DELETED'&&<div className="flex flex-wrap gap-2"><button className={button} disabled={busy||session.task.lifecycle==='PUBLISHED'} onClick={()=>void control('lifecycle','PUBLISHED')}>{t('auditPublish')}</button><button className={button} disabled={busy||session.task.lifecycle!=='PUBLISHED'} onClick={()=>void control('lifecycle','WITHDRAWN')}>{t('auditWithdraw')}</button><button className={button} disabled={busy} onClick={()=>void control('lifecycle','DELETED')}>{t('auditDelete')}</button></div>}
  </div>}
 </div>;
 return <div className="max-w-2xl mx-auto px-2 sm:px-4 py-3 space-y-3 pb-24">
  {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}{busy&&<p role="status" className="text-xs">{t('compareLoading')}</p>}
  {!mobile&&management}
  {session&&<CountWorkspace key={session.task.id} session={session} active={active} claimBusy={busy} operator={operator} setOperator={setOperator} onClaim={()=>void control('claim')} onReload={()=>void open(session.task.id)}/>}
  {mobile&&management}
 </div>;
}
function CountWorkspace({session,active,operator,setOperator,onClaim,claimBusy,onReload}:{session:AuditSession<CountTask>;active:boolean;operator:string;setOperator:(value:string)=>void;onClaim:()=>void;claimBusy:boolean;onReload:()=>void}){
 useSyncExternalStore(session.subscribe,session.snapshot);
 const task=session.task,all=task.plan.route,key=`wms-sku-count-location:${task.hall}:${task.id}`;
 const [location,setLocation]=useState(()=>all.includes(read(key))?read(key):all.find(code=>!task.results[code]?.completed)||all[0]);
 const [scan,setScan]=useState(''),[manual,setManual]=useState(false),[scanError,setScanError]=useState(''),[filter,setFilter]=useState(''),[page,setPage]=useState(1);
 const scanner=useRef<HTMLInputElement>(null),target=task.plan.targets.find(t=>t.location===location),result=target?session.result(location):null,draft=session.drafts.get(location);
 useEffect(()=>remember(key,location),[key,location]);
 useEffect(()=>registerLanguageSafety(`sku-count:${task.id}`,{dirty:()=>session.dirty,busy:()=>session.busy}),[session]);
 useEffect(()=>{if(!active)return;const input=scanner.current;if(input){setManual(false);input.blur();input.inputMode='none';input.focus({preventScroll:true});}if(isHandheldDevice())window.scrollTo({top:0,left:0,behavior:'auto'});},[active,location]);
 useEffect(()=>{const save=()=>{for(const code of session.drafts.keys())void session.flush(code);};const hidden=()=>{if(document.visibilityState==='hidden')save();};window.addEventListener('pagehide',save);document.addEventListener('visibilitychange',hidden);return()=>{save();window.removeEventListener('pagehide',save);document.removeEventListener('visibilitychange',hidden);};},[session]);
 const choose=(code:string)=>{void session.flush(location);setLocation(code);remember(key,code);setScan('');setScanError('');};
 const index=all.indexOf(location),previous=all[index-1],next=[...all.slice(index+1),...all.slice(0,index)].find(code=>session.drafts.get(code)?.dirty||!task.results[code]?.completed);
 const done=all.filter(code=>!session.drafts.get(code)?.dirty&&task.results[code]?.completed).length;
 const route=all.filter(code=>code.includes(filter.trim().toUpperCase()));
 const go=()=>{const code=scan.trim().toUpperCase(),matches=all.filter(key=>key===code||task.plan.locations?.[key]?.code===code);if(matches.length===1)choose(matches[0]);else setScanError(t(matches.length>1?'skuAmbiguousLocation':'auditNotTarget'));};
 const navigation=<nav className="grid grid-cols-2 gap-2"><button aria-label={t('auditPrev')} disabled={!previous} className={`${button} text-left`} onClick={()=>previous&&choose(previous)}><span className="block text-xs text-slate-500">{t('auditPrev')}</span><strong className="font-mono">{previous||t('auditNoPrevious')}</strong></button><button aria-label={t('auditNext')} disabled={!next} className={`${button} text-right bg-blue-50`} onClick={()=>next&&choose(next)}><span className="block text-xs text-blue-600">{t('auditNext')}</span><strong className="font-mono">{next||t('auditNoNext')}</strong></button></nav>;
 return <div className="space-y-3" data-sku-workspace>
  {session.unavailable&&<div role="alert" className="bg-amber-50 p-3 rounded text-sm"><p>{t('skuTaskChanged')}</p>{session.dirty&&<button className={button} disabled={session.busy} onClick={()=>void session.archiveDrafts().then(()=>{forgetCountSession(task.id);onReload();})}>{t('auditArchiveDraft')}</button>}{!session.dirty&&<button className={button} onClick={onReload}>{t('retry')}</button>}</div>}
  {session.storageError&&<p role="alert">{t('auditStorage')}</p>}
  {!task.canEdit&&!session.unavailable&&<div className="bg-white border rounded-xl p-3 space-y-2"><p className="text-sm">{task.lifecycle!=='PUBLISHED'?t(('auditState'+task.lifecycle) as 'auditStateDRAFT'):task.claimedBy?t('skuClaimedBy',{name:task.claimedBy}):t('skuUnclaimed')}</p>{task.lifecycle==='PUBLISHED'&&!task.claimedBy&&<><input aria-label={t('skuOperator')} value={operator} maxLength={80} onChange={e=>{setOperator(e.target.value);remember('wms-sku-count-operator',e.target.value);}} placeholder={t('skuOperator')} className={field}/><button className={button} disabled={claimBusy||!operator.trim()} onClick={onClaim}>{t('skuClaim')}</button></>}</div>}
  {draft?.error&&<p role="alert" className="text-red-600 text-sm">{message(new Error(draft.error))}{draft.error!=='REVISION_CONFLICT'&&!session.unavailable&&task.canEdit&&<button className="underline ml-2" onClick={()=>void session.flush(location)}>{t('retry')}</button>}</p>}
  {target&&result&&<TaskInspectionEditor key={location} session={session} target={target} result={result} active={active} disabled={!task.canEdit||session.unavailable||draft?.error==='REVISION_CONFLICT'} navigation={navigation}/>}
  <p role="status" className="text-xs text-slate-500">{draft?.saving?t('auditSaving'):draft?.dirty?t('auditSavePending'):task.results[location]?.savedAt?t('saved'):t('auditUnsaved')}</p>
  <div className="bg-white border rounded-xl p-3 space-y-2"><p className="text-sm font-semibold">{task.name} · {done}/{all.length}</p>
   <div className="flex gap-2"><input ref={scanner} aria-label={t('auditScanner')} inputMode={manual?'text':'none'} value={scan} onChange={e=>setScan(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();go();}}} className={`${field} flex-1 min-w-0`}/><button aria-label={t('auditManual')} className="rounded-full border p-2" onClick={()=>{const input=scanner.current;if(input){input.blur();input.inputMode=manual?'none':'text';setManual(!manual);input.focus({preventScroll:true});}}}><Keyboard className="w-5 h-5"/></button><button className={button} onClick={go}>{t('query')}</button></div>
   {scanError&&<p role="alert">{scanError}</p>}
  </div>
  <details className="bg-white border rounded-xl p-3"><summary>{t('auditRoute')} · {all.length}</summary><input value={filter} placeholder={t('compareSearch')} onChange={e=>{setFilter(e.target.value);setPage(1);}} className={`${field} w-full my-2`}/><div className="space-y-1">{route.slice((page-1)*30,page*30).map(code=><button key={code} onClick={()=>choose(code)} className={`${button} w-full flex justify-between ${code===location?'border-blue-500':''}`}><span className="font-mono">{code}</span><span>{task.results[code]?.completed&&!session.drafts.get(code)?.dirty?t('auditDone'):t('auditPending')}{task.results[code]?.anomaly?' · '+t('auditAnomaly'):''}</span></button>)}</div><div className="flex justify-between mt-2"><button className={button} disabled={page===1} onClick={()=>setPage(page-1)}>{t('comparePrev')}</button><span>{page}/{Math.max(1,Math.ceil(route.length/30))}</span><button className={button} disabled={page*30>=route.length} onClick={()=>setPage(page+1)}>{t('compareNext')}</button></div></details>
 </div>;
}

function SourceAreas({rows,returnsOnly=false}:{rows:CountRow[];returnsOnly?:boolean}){
 const [shown,setShown]=useState(30);
 const returns=rows.filter(r=>isReturnArea(r.hall));
 const scopes=orderedScopes(rows.filter(r=>!isReturnArea(r.hall)).map(r=>areaScope(r.hall)));
 return <div className="space-y-2 text-xs" data-sku-area-preview>
  {!returnsOnly&&<div className="space-y-1">{scopes.map(scope=>{const own=rows.filter(r=>!isReturnArea(r.hall)&&areaScope(r.hall)===scope);return <p key={scope}>{scopeLabel(scope,t('skuSmallGoods'))}: {t('skuAreaSummary',{rows:own.length,locations:new Set(own.map(r=>JSON.stringify([r.hall.toUpperCase(),r.location]))).size,skus:new Set(own.map(r=>r.sku)).size,qty:own.reduce((sum,r)=>sum+r.qty,0)})}{scope==='SMALL_GOODS'&&own.length>0&&<span className="text-slate-500"> · {[...new Set(own.map(r=>r.hall))].join(' / ')}</span>}</p>;})}</div>}
  {returns.length>0&&<details className="border border-amber-300 rounded p-2" open><summary className="font-semibold text-amber-800">RT · {t('skuReturnsExcluded')} · {t('skuAreaSummary',{rows:returns.length,locations:new Set(returns.map(r=>r.location)).size,skus:new Set(returns.map(r=>r.sku)).size,qty:returns.reduce((sum,r)=>sum+r.qty,0)})}</summary><div className="overflow-auto max-h-56"><table className="w-full text-left"><thead><tr><th>{t('skuAreaGroup')}</th><th>{t('location')}</th><th>SKU</th><th>{t('skuSourceQty')}</th></tr></thead><tbody>{returns.slice(0,shown).map((r,index)=><tr key={index}><td>{r.hall}</td><td>{r.location}</td><td className="break-all">{r.sku}</td><td>{r.qty}</td></tr>)}</tbody></table></div>{shown<returns.length&&<button className={button} onClick={()=>setShown(shown+30)}>{t('skuShowMore')}</button>}</details>}
 </div>;
}
