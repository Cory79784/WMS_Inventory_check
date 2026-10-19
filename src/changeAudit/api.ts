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
}
export const listTasks = (hallId: string, signal?: AbortSignal) => call<{
    tasks: TaskSummary[];
    activeImportId: string | null;
}>('tasks', { hallId }, { signal });
export const loadTask = (hallId: string, taskId: string) => call<AuditTask>('task', { hallId, taskId });
export const taskStatus = (hallId: string, taskId: string) => call<{
    stale: boolean;
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
export const saveResult = (hallId: string, taskId: string, location: string, result: AuditResult) => call<AuditResult>('save', { hallId, taskId, location }, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
export const photoUrl = (hallId: string, taskId: string, photoId: string) => `${base}photo?${new URLSearchParams({ hallId, taskId, photoId })}`;
export const uploadPhoto = (hallId: string, taskId: string, location: string, lineId: string, id: string, file: File) => call<AuditPhoto>('photo', { hallId, taskId, location, lineId, photoId: id }, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
export function auditId(): string { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
