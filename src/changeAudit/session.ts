import { putPhotoDraft, readPhotoDrafts, deletePhotoDraft } from './photoDrafts';
import { blankResult } from './model';
import type { AuditResult, AuditTask, InspectionTaskBase } from './model';
import { AuditError, saveResult, taskStatus, uploadPhoto, loadProgress, photoUrl } from './api';
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
export interface InspectionTransport {
    saveResult:typeof saveResult;uploadPhoto:typeof uploadPhoto;loadProgress:typeof loadProgress;
    taskStatus:(hall:string,id:string)=>Promise<{stale:boolean;lifecycle?:AuditTask['lifecycle'];publicationRevision?:number;resultStamp?:string;canEdit?:boolean}>;
    photoUrl:typeof photoUrl;
}
const defaultTransport:InspectionTransport={saveResult,uploadPhoto,loadProgress,taskStatus,photoUrl};
export class AuditSession<T extends InspectionTaskBase = AuditTask> {
    private listeners = new Set<() => void>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private tick = 0;
    private lastVersionCheck = 0;
    private resultStamp = '';
    private checking = false;
    private activeUploads = new Set<string>();
    private photoStorageFailure = false;
    drafts = new Map<string, Draft>();
    uploads: Upload[] = [];
    storageError = false;
    unavailable = false;
    private draftPublication = 0;
    constructor(public task: T, private transport:InspectionTransport = defaultTransport) {
        this.draftPublication=task.publicationRevision || 0;
        try {
            const envelope = JSON.parse(localStorage.getItem(this.key) || '{}');
            const saved = envelope.drafts || envelope;
            if((envelope.publicationRevision ?? 0) !== this.draftPublication && Object.keys(saved).length) this.unavailable=true;
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
                if (!conflict && !task.stale && task.canEdit!==false && !this.unavailable)
                    this.schedule(location);
            }
        }
        catch {
            this.storageError = true;
        }
        if (globalThis.indexedDB)
            void readPhotoDrafts(this.photoNamespace).then(photos => {
                for (const photo of photos) {
                    if (this.task.photos.some(p => p.id === photo.id)) {
                        void deletePhotoDraft(photo.id).catch(() => { });
                        continue;
                    }
                    if((photo.publicationRevision ?? 0)!==(this.task.publicationRevision || 0)) this.unavailable=true;
                    if (!this.uploads.some(p => p.id === photo.id))
                        this.uploads.push({ ...photo, url: URL.createObjectURL(photo.file), status: 'failed', error: 'UPLOAD_INTERRUPTED' });
                }
                this.emit();
            }).catch(() => { this.storageError = true; this.emit(); });
    }
    get photoNamespace() {return this.task.kind==='SKU' ? `sku-count:${this.task.id}` : this.task.id;}
    get key() { return this.task.kind==='SKU' ? `wms-sku-count-drafts:${this.task.id}` : `wms-change-audit-drafts:${this.task.id}`; }
    photoUrl(id:string) {return this.transport.photoUrl(this.task.hall,this.task.id,id);}
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    snapshot = () => this.tick;
    private emit() { this.tick++; this.listeners.forEach(listener => listener()); }
    private persist() {
        try {
            localStorage.setItem(this.key, JSON.stringify({publicationRevision:this.draftPublication,drafts:Object.fromEntries([...this.drafts].filter(([, d]) => d.dirty).map(([code, d]) => [code, d.value]))}));
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
        if (this.task.canEdit===false || this.task.stale || this.unavailable || this.task.lifecycle==='WITHDRAWN' || this.task.lifecycle==='DELETED')
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
        if (!draft || !draft.dirty || draft.saving || draft.error === 'REVISION_CONFLICT' || this.task.canEdit===false || this.task.stale || this.unavailable || this.task.lifecycle==='WITHDRAWN' || this.task.lifecycle==='DELETED')
            return;
        draft.saving = true;
        draft.error = '';
        const sequence = draft.sequence, value = structuredClone(draft.value);
        this.emit();
        try {
            const saved = await this.transport.saveResult(this.task.hall, this.task.id, location, value, this.task.publicationRevision || 0);
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
            if(error instanceof AuditError && ['TASK_UNAVAILABLE','PUBLICATION_CONFLICT','MANAGEMENT_REQUIRED','CLAIM_REQUIRED'].includes(error.code)) this.unavailable=true;
            if (error instanceof AuditError && error.code === 'STALE_VERSION')
                this.task.stale = true;
            this.persist();
        }
        finally {
            this.emit();
        }
    }
    async archiveDrafts() {
        if(this.busy) throw new Error('BUSY');
        const archive=`wms-${this.task.kind==='SKU'?'sku-count':'change-audit'}-quarantine:${this.task.hall}:${this.task.id}:${Date.now()}`;
        // Write the archive before removing the active queue. Quota failures leave it untouched.
        localStorage.setItem(archive,JSON.stringify({taskId:this.task.id,hall:this.task.hall,publicationRevision:this.draftPublication,drafts:Object.fromEntries([...this.drafts].filter(([,d])=>d.dirty).map(([code,d])=>[code,d.value]))}));
        if(globalThis.indexedDB) {
            const photos=await readPhotoDrafts(this.photoNamespace);
            for(const photo of photos) await putPhotoDraft({...photo,taskId:archive});
        }
        this.timers.forEach(timer=>clearTimeout(timer));this.timers.clear();
        this.uploads.forEach(upload=>URL.revokeObjectURL(upload.url));this.uploads=[];this.drafts.clear();
        localStorage.removeItem(this.key);if(this.task.kind!=='SKU') sessions.delete(this.task.id);this.emit();
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
        if(this.task.kind!=='SKU') sessions.delete(this.task.id);
        this.emit();
    }
    async checkVersion(force = false) {
        if(this.checking || this.unavailable) return;
        if (!force && Date.now() - this.lastVersionCheck < 60000)
            return;
        this.lastVersionCheck = Date.now();
        this.checking=true;
        try {
            const status = await this.transport.taskStatus(this.task.hall, this.task.id);
            if(status.publicationRevision!==undefined && status.publicationRevision!==this.task.publicationRevision) this.unavailable=true;
            if(status.canEdit===false && this.task.canEdit===true) this.unavailable=true;
            if(status.canEdit!==undefined) this.task.canEdit=status.canEdit;
            this.task.stale = status.stale;
            if(status.lifecycle) this.task.lifecycle=status.lifecycle;
            if(!this.unavailable && status.resultStamp && status.resultStamp!==this.resultStamp && !this.busy) {
                const progress=await this.transport.loadProgress(this.task.hall,this.task.id);
                for(const [code,draft] of this.drafts) {
                    if(!draft.dirty) this.drafts.delete(code);
                    else if((progress.results[code]?.revision || 0)!==draft.value.revision) draft.error='REVISION_CONFLICT';
                }
                this.task.results=progress.results;this.task.photos=progress.photos;this.resultStamp=status.resultStamp;
            }
            this.emit();
        }
        catch(error) { if(error instanceof AuditError && [403,404,410].includes(error.status)) { this.unavailable=true; this.emit(); } }
        finally {this.checking=false;}
    }
    async addPhoto(upload: Upload) {
        if (this.task.canEdit===false || this.task.stale || this.unavailable || this.task.lifecycle==='WITHDRAWN' || this.task.lifecycle==='DELETED')
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
                await putPhotoDraft({ ...upload, taskId: this.photoNamespace, publicationRevision:this.task.publicationRevision || 0 });
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
            const saved = await this.transport.uploadPhoto(this.task.hall, this.task.id, upload.location, upload.lineId, upload.id, upload.file, this.task.publicationRevision || 0);
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
            if(error instanceof AuditError && ['TASK_UNAVAILABLE','PUBLICATION_CONFLICT','MANAGEMENT_REQUIRED','CLAIM_REQUIRED'].includes(error.code)) this.unavailable=true;
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
    if (session?.unavailable && !session.dirty && !session.busy) {sessions.delete(task.id);session=undefined;}
    if (!session) {
        session = new AuditSession(task);
        sessions.set(task.id, session);
    }
    else if (!session.busy) {
        if(session.dirty && session.task.publicationRevision!==task.publicationRevision) session.unavailable=true;
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

export async function flushChangeAuditDrafts() { await Promise.all([...sessions.values()].flatMap(s=>[...s.drafts.keys()].map(code=>s.flush(code)))); }
