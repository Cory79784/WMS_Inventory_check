import type { HallId, SnapshotComparison, SnapshotVersion } from '../types';
export async function fetchSnapshotVersions(hallId: HallId, signal?: AbortSignal): Promise<{
    versions: SnapshotVersion[];
    activeImportId: string | null;
}> {
    const response = await fetch(`/api/inventory/snapshot-versions?hallId=${hallId}`, { signal });
    const result = await response.json();
    if (!response.ok || !result.success)
        throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}
export async function compareSnapshots(hallId: HallId, oldImportId: string, newImportId: string, signal?: AbortSignal): Promise<SnapshotComparison> {
    const params = new URLSearchParams({ hallId, oldImportId, newImportId });
    const response = await fetch(`/api/inventory/snapshot-compare?${params}`, { signal });
    const result = await response.json();
    if (!response.ok || !result.success)
        throw new Error(result.error || `HTTP ${response.status}`);
    return result.data;
}
