import {AuditSession} from '../changeAudit/session';
import {countTransport} from './api';
import type {CountTask} from './model';
const sessions=new Map<string,AuditSession<CountTask>>();
export function countSession(task:CountTask){
 let session=sessions.get(task.id);
 if(session?.dirty||session?.busy){
  if(session.task.publicationRevision!==task.publicationRevision)session.unavailable=true;
  if(!session.busy){for(const [code,draft] of session.drafts)if(draft.dirty&&(task.results[code]?.revision||0)!==draft.value.revision)draft.error='REVISION_CONFLICT';session.task=task;}
 }else {session=new AuditSession(task,countTransport);sessions.set(task.id,session);}
 return session!;
}
export const hasSkuCountDrafts=()=>[...sessions.values()].some(s=>s.dirty);
export const flushSkuCountDrafts=async()=>{await Promise.all([...sessions.values()].flatMap(s=>[...s.drafts.keys()].map(code=>s.flush(code))));};
export const forgetCountSession=(id:string)=>sessions.delete(id);
