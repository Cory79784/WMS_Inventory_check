import {useEffect,useState} from 'react';
import {t} from '../i18n';
import {InspectionDiscrepancyBadge} from '../components/InspectionDiscrepancyBadge';
import {loadInspectionReference,type InspectionReference} from './api';
import type {AuditTask,AuditLine} from './model';
// One request per visited location, not per SKU. A short cache avoids repeated route jumps.
const cache=new Map<string,{at:number;data:InspectionReference}>();
export function useInspectionReference(task:AuditTask|null,location:string,active=true) {
    const key=task?JSON.stringify([task.hall,task.id,task.plan.comparison.newVersion.importId,location]):'';
    const [data,setData]=useState<InspectionReference|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
    useEffect(()=>{
        if(!active || !task) return;
        const abort=new AbortController();
        setData(null);setError(false);
        const load=async(force=false)=>{
            const stored=cache.get(key);
            if(!force && stored && Date.now()-stored.at<60000) {setData(stored.data);return;}
            try {
                const fresh=await loadInspectionReference(task.hall,task.id,location,abort.signal);
                if(abort.signal.aborted) return;
                // Never display a response under a different frozen reference version.
                if(fresh.referenceImportId!==task.plan.comparison.newVersion.importId) throw new Error('REFERENCE_VERSION');
                if(cache.size>=100) cache.delete(cache.keys().next().value!);
                cache.set(key,{at:Date.now(),data:fresh});setData(fresh);setError(false);
            } catch {if(!abort.signal.aborted) {setData(null);setError(true);}}
        };
        void load(attempt>0);
        const focus=()=>{if(document.visibilityState!=='hidden') void load();};
        window.addEventListener('focus',focus);
        return ()=>{abort.abort();window.removeEventListener('focus',focus);};
    },[key,attempt,active]);
    return {data,error,retry:()=>setAttempt(value=>value+1)};
}
export function matchesReference(row:InspectionReference['rows'][number],line:AuditLine) {
    return row.sku ? !!line.sku && row.sku===line.sku : !!row.barcode && row.barcode===line.barcode;
}
export function InspectionReferenceRows({rows,version,identify=false}:{rows:InspectionReference['rows'];version:number;identify?:boolean}) {
    if(!rows.length) return null;
    return <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs" data-original-reference>
      <p className="text-slate-500">{t('auditOriginalReference',{version})}</p>
      {rows.map(row=><div key={row.id} className="flex flex-wrap items-center gap-1.5 text-slate-600">
        {identify && <span className="font-mono break-all">{row.sku || row.barcode || t('auditUnknownGoods')}</span>}
        <InspectionDiscrepancyBadge item={row}/>
        <span>{t('book')} {row.systemQty} · {t('actual')} {row.actualQty}</span>
        {row.isReturn && <span>{t('returnShort')}{row.returnCode ? ` · ${row.returnCode}` : ''}</span>}
      </div>)}
    </div>;
}
