import { putPhotoDraft, readPhotoDrafts, deletePhotoDraft } from './photoDrafts';
import { blankResult } from './model';
import type { AuditResult, AuditTask } from './model';
import { AuditError, saveResult, taskStatus, uploadPhoto } from './api';
export interface Draft {
    value: AuditResult;
    dirty: boolean;
    saving: boolean;
    error: string;
    sequence: number;
}
export interface Upload {
    id: string;
    location: string;
    lineId: string;
    file: File;
    url: string;
    status: 'uploading' | 'failed' | 'saved';
    error: string;
}
export class AuditSession {
    private listeners = new Set<() => void>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private tick = 0;
    private lastVersionCheck = 0;
    private activeUploads = new Set<string>();
    private photoStorageFailure = false;
    drafts = new Map<string, Draft>();
    uploads: Upload[] = [];
    storageError = false;
    constructor(public task: AuditTask) {
        try {
            const saved = JSON.parse(localStorage.getItem(this.key) || '{}');
            for (const [location, value] of Object.entries(saved) as Array<[
                string,
                AuditResult
            ]>) {
                if (!task.plan.targets.some(t => t.location === location) || !value || !Array.isArray(value.lines))
                    continue;
                const server = task.results[location];
                const same = server && JSON.stringify([server.lines, server.notes, server.completed, server.emptyConfirmed, server.ignoredPhotoIds, server.photoLines]) === JSON.stringify([value.lines, value.notes, value.completed, value.emptyConfirmed, value.ignoredPhotoIds, value.photoLines]);
                if (same)
                    continue;
                const conflict = (server?.revision || 0) !== value.revision;
                this.drafts.set(location, { value, dirty: true, saving: false, error: conflict ? 'REVISION_CONFLICT' : '', sequence: 0 });
                if (!conflict && !task.stale)
                    this.schedule(location);
            }
        }
        catch {
            this.storageError = true;
        }
        if (globalThis.indexedDB)
            void readPhotoDrafts(task.id).then(photos => {
                for (const photo of photos) {
                    if (this.task.photos.some(p => p.id === photo.id)) {
                        void deletePhotoDraft(photo.id).catch(() => { });
                        continue;
                    }
                    if (!this.uploads.some(p => p.id === photo.id))
                        this.uploads.push({ ...photo, url: URL.createObjectURL(photo.file), status: 'failed', error: 'UPLOAD_INTERRUPTED' });
                }
                this.emit();
            }).catch(() => { this.storageError = true; this.emit(); });
    }
    get key() { return `wms-change-audit-drafts:${this.task.id}`; }
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    snapshot = () => this.tick;
    private emit() { this.tick++; this.listeners.forEach(listener => listener()); }
    private persist() {
        try {
            localStorage.setItem(this.key, JSON.stringify(Object.fromEntries([...this.drafts].filter(([, d]) => d.dirty).map(([code, d]) => [code, d.value]))));
            this.storageError = this.photoStorageFailure;
        }
        catch {
            this.storageError = true;
        }
    }
    get dirty() { return [...this.drafts.values()].some(d => d.dirty) || this.uploads.some(u => u.status !== 'saved'); }
    get busy() { return [...this.drafts.values()].some(d => d.saving) || this.uploads.some(u => u.status === 'uploading'); }
    result(location: string): AuditResult {
        return this.drafts.get(location)?.value || this.task.results[location] || blankResult(this.task.plan.targets.find(t => t.location === location)!);
    }
    edit(location: string, value: AuditResult) {
        if (this.task.stale)
            return;
        const old = this.drafts.get(location);
        this.drafts.set(location, { value: { ...value, revision: old?.value.revision ?? this.task.results[location]?.revision ?? 0 }, dirty: true, saving: old?.saving || false, error: old?.error === 'REVISION_CONFLICT' ? old.error : '', sequence: (old?.sequence || 0) + 1 });
        this.persist();
        this.emit();
        this.schedule(location);
    }
    private schedule(location: string) {
        clearTimeout(this.timers.get(location));
        this.timers.set(location, setTimeout(() => { this.timers.delete(location); void this.flush(location); }, 650));
    }
    async flush(location: string) {
        const draft = this.drafts.get(location);
        if (!draft || !draft.dirty || draft.saving || draft.error === 'REVISION_CONFLICT' || this.task.stale)
            return;
        draft.saving = true;
        draft.error = '';
        const sequence = draft.sequence, value = structuredClone(draft.value);
        this.emit();
        try {
            const saved = await saveResult(this.task.hall, this.task.id, location, value);
            if (!saved.savedAt || saved.revision !== value.revision + 1 || JSON.stringify([saved.lines, saved.notes, saved.completed, saved.emptyConfirmed, saved.ignoredPhotoIds, saved.photoLines]) !== JSON.stringify([value.lines, value.notes, value.completed, value.emptyConfirmed, value.ignoredPhotoIds, value.photoLines]))
                throw new Error('SAVE_NOT_CONFIRMED');
            this.task.results[location] = saved;
            const latest = this.drafts.get(location)!;
            latest.saving = false;
            if (latest.sequence === sequence) {
                latest.value = saved;
                latest.dirty = false;
            }
            else {
                latest.value.revision = saved.revision;
                this.schedule(location);
            }
            this.persist();
        }
        catch (error) {
            const latest = this.drafts.get(location)!;
            latest.saving = false;
            latest.error = error instanceof Error ? error.message : 'SAVE_FAILED';
            if (error instanceof AuditError && error.code === 'STALE_VERSION')
                this.task.stale = true;
            this.persist();
        }
        finally {
            this.emit();
        }
    }
    async discard() {
        if (this.busy)
            throw new Error('BUSY');
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        for (const upload of this.uploads) {
            if (globalThis.indexedDB)
                await deletePhotoDraft(upload.id);
            URL.revokeObjectURL(upload.url);
        }
        this.uploads = [];
        this.drafts.clear();
        localStorage.removeItem(this.key);
        sessions.delete(this.task.id);
        this.emit();
    }
    async checkVersion(force = false) {
        if (!force && Date.now() - this.lastVersionCheck < 60000)
            return;
        this.lastVersionCheck = Date.now();
        try {
            const status = await taskStatus(this.task.hall, this.task.id);
            this.task.stale = status.stale;
            this.emit();
        }
        catch { /* Network failure never acknowledges unsaved counts. Writes still check the server pointer. */ }
    }
    async addPhoto(upload: Upload) {
        if (this.task.stale)
            return;
        if (!this.uploads.includes(upload))
            this.uploads.push(upload);
        if (upload.status === 'uploading' && this.uploads.some(other => other === upload) && this.activeUploads.has(upload.id))
            return;
        this.activeUploads.add(upload.id);
        upload.status = 'uploading';
        upload.error = '';
        this.emit();
        try {
            try {
                await putPhotoDraft({ ...upload, taskId: this.task.id });
            }
            catch {
                this.photoStorageFailure = true;
                this.storageError = true;
            }
            if (upload.lineId.startsWith('extra:')) {
                await this.flush(upload.location);
                if (this.drafts.get(upload.location)?.dirty)
                    throw new Error('SAVE_LINES_FIRST');
            }
            const saved = await uploadPhoto(this.task.hall, this.task.id, upload.location, upload.lineId, upload.id, upload.file);
            if (!saved.id)
                throw new Error('SAVE_NOT_CONFIRMED');
            if (!this.task.photos.some(p => p.id === saved.id))
                this.task.photos.push(saved);
            upload.status = 'saved';
            URL.revokeObjectURL(upload.url);
            if (globalThis.indexedDB)
                await deletePhotoDraft(upload.id).catch(() => { this.storageError = true; });
        }
        catch (error) {
            upload.status = 'failed';
            upload.error = error instanceof Error ? error.message : 'UPLOAD_FAILED';
            if (error instanceof AuditError && error.code === 'STALE_VERSION')
                this.task.stale = true;
        }
        this.activeUploads.delete(upload.id);
        this.emit();
    }
}
const sessions = new Map<string, AuditSession>();
export function sessionFor(task: AuditTask): AuditSession {
    let session = sessions.get(task.id);
    if (!session) {
        session = new AuditSession(task);
        sessions.set(task.id, session);
    }
    else if (!session.busy) {
        for (const [location, draft] of session.drafts) {
            if (!draft.dirty) {
                session.drafts.delete(location);
                continue;
            }
            const server = task.results[location];
            if ((server?.revision || 0) !== draft.value.revision)
                draft.error = 'REVISION_CONFLICT';
        }
        session.task = task;
    }
    else
        session.task.stale = task.stale;
    return session;
}
export function hasChangeAuditDrafts() { return [...sessions.values()].some(s => s.dirty); }
