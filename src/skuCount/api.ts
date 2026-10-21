import {AuditError} from '../changeAudit/api';
import type {InspectionTransport} from '../changeAudit/session';
import type {AuditPhoto,AuditResult} from '../changeAudit/model';
import type {CountTask,CountRow} from './model';
const root='/api/inventory/sku-count/';
async function call<T>(action:string,params:Record<string,string>={},options?:RequestInit):Promise<T>{
 const response=await fetch(root+action+'?'+new URLSearchParams(params),options);const data=await response.json();
 if(!response.ok)throw new AuditError(data.error || 'REQUEST_FAILED',response.status);return data;
}
const post=(data:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
export interface CountSummary {id:string;name:string;lifecycle:CountTask['lifecycle'];publicationRevision:number;claimedBy:string|null;mine:number;sourceFile:string;total:number;completed:number;createdAt:string}
export const listCountTasks=(hallId:string,signal?:AbortSignal,archived=false)=>call<{tasks:CountSummary[]}>('tasks',{hallId,...(archived?{archived:'1'}:{})},{signal});
export const loadCountTask=(hallId:string,taskId:string)=>call<CountTask>('task',{hallId,taskId});
export const createCountTask=(hallId:string,payload:{id:string;name:string;rows:CountRow[];skus:string[];sourceFile:string;sourceHash:string})=>call<{id:string}>('tasks',{hallId},post(payload));
export const countManager=()=>call<{manager:boolean;configured:boolean}>('manager');
export const authorizeCountManager=(key:string)=>call('manager',{},post({key}));
export const lockCountManager=()=>call('manager',{},{method:'DELETE'});
export const countControl=(hallId:string,taskId:string,action:'claim'|'release'|'lifecycle',payload:unknown)=>call(action,{hallId,taskId},post(payload));
export const countTransport:InspectionTransport={
 saveResult:(hallId,taskId,location,result,revision=0)=>call<AuditResult>('save',{hallId,taskId,location},{...post(result),headers:{'Content-Type':'application/json','X-Audit-Publication-Revision':String(revision)}}),
 uploadPhoto:(hallId,taskId,location,lineId,photoId,file,revision=0)=>call<AuditPhoto>('photo',{hallId,taskId,location,lineId,photoId},{method:'POST',headers:{'Content-Type':file.type,'X-Audit-Publication-Revision':String(revision)},body:file}),
 taskStatus:(hallId,taskId)=>call('status',{hallId,taskId}),loadProgress:(hallId,taskId)=>call('progress',{hallId,taskId}),
 photoUrl:(hallId,taskId,photoId)=>root+'photo?'+new URLSearchParams({hallId,taskId,photoId})
};
