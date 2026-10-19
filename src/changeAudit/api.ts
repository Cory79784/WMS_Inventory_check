import type { AuditPhoto, AuditResult, AuditTask, RouteConfig } from './model';
const base = '/api/inventory/change-audit/';
export class AuditError extends Error {
    constructor(public code: string, public status: number) { super(code); }
}
async function call<T>(path: string, params: Record<string, string>, options?: RequestInit): Promise<T> {
    const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`, options);
    const data = await response.json();
    if (!response.ok)
        throw new AuditError(data.error || `HTTP ${response.status}`, response.status);
    return data;
}
export interface TaskSummary {
    id: string;
    oldId: string;
    newId: string;
    createdAt: string;
    status?: string;
    publicationRevision?: number;
}
export const listTasks = (hallId: string, signal?: AbortSignal, archived = false) => call<{
    tasks: TaskSummary[];
    activeImportId: string | null;
}>('tasks', { hallId, ...(archived?{archived:'1'}:{}) }, { signal });
export const loadTask = (hallId: string, taskId: string) => call<AuditTask>('task', { hallId, taskId });
export const taskStatus = (hallId: string, taskId: string) => call<{
    resultStamp?:string;
    stale: boolean;
    lifecycle?: AuditTask['lifecycle'];
    publicationRevision?: number;
}>('status', { hallId, taskId });
export const createTask = (hallId: string, payload: {
    id: string;
    oldId: string;
    newId: string;
    config: RouteConfig;
}) => call<{
    id: string;
    task?: AuditTask;
}>('tasks', { hallId }, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
export const saveResult = (hallId: string, taskId: string, location: string, result: AuditResult, publicationRevision = 0) => call<AuditResult>('save', { hallId, taskId, location }, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Audit-Publication-Revision': String(publicationRevision) }, body: JSON.stringify(result) });
export const photoUrl = (hallId: string, taskId: string, photoId: string) => `${base}photo?${new URLSearchParams({ hallId, taskId, photoId })}`;
export const uploadPhoto = (hallId: string, taskId: string, location: string, lineId: string, id: string, file: File, publicationRevision = 0) => call<AuditPhoto>('photo', { hallId, taskId, location, lineId, photoId: id }, { method: 'POST', headers: { 'Content-Type': file.type, 'X-Audit-Publication-Revision':String(publicationRevision) }, body: file });
export function auditId(): string { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }

export const managerStatus = () => call<{manager:boolean;configured:boolean}>('manager', {});
export const unlockManager = (key:string) => call<{manager:boolean}>('manager', {}, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
export const lockManager = () => call('manager', {}, {method:'DELETE'});
export const changeLifecycle = (hallId:string, taskId:string, status:string, revision:number) => call<{lifecycle:AuditTask['lifecycle'];publicationRevision:number}>('lifecycle',{hallId,taskId},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,revision})});

export const loadProgress = (hallId:string,taskId:string) => call<Pick<AuditTask,'results'|'photos'>>('progress',{hallId,taskId});

// Read-only original inspection context. Never adapted into task result payloads.
export interface InspectionReference {
    referenceImportId:string;
    versionNumber:number;
    rows:Array<{id:string;sku:string;barcode:string;systemQty:number;actualQty:number;differenceQty:number;
        discrepancyType:'NORMAL'|'SHORTAGE'|'SURPLUS'|'UNEXPECTED_SKU'|'NO_SKU_SURPLUS'|null;
        notes:string;isReturn:boolean;returnCode:string}>;
}
export const loadInspectionReference=(hallId:string,taskId:string,location:string,signal?:AbortSignal)=>call<InspectionReference>('inspection-reference',{hallId,taskId,location},{signal});
