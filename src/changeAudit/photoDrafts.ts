// Pending image bytes survive refresh without putting large base64 strings in localStorage.
export interface PhotoDraft {
    id: string;
    publicationRevision?: number;
    taskId: string;
    location: string;
    lineId: string;
    file: File;
}
function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error('PHOTO_DRAFT_STORAGE'));
            return;
        }
        const request = indexedDB.open('wms-change-audit', 1);
        request.onupgradeneeded = () => { request.result.createObjectStore('photos', { keyPath: 'id' }).createIndex('taskId', 'taskId'); };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}
async function write(action: (store: IDBObjectStore) => void) {
    const db = await open();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('photos', 'readwrite');
            action(tx.objectStore('photos'));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    finally {
        db.close();
    }
}
export const putPhotoDraft = (photo: PhotoDraft) => write(store => { store.put(photo); });
export const deletePhotoDraft = (id: string) => write(store => { store.delete(id); });
export async function readPhotoDrafts(taskId: string): Promise<PhotoDraft[]> {
    const db = await open();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('photos').objectStore('photos').index('taskId').getAll(taskId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    finally {
        db.close();
    }
}
