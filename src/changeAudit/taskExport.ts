import type { InspectionExportRow, SnapshotVersion } from '../types';
import { buildInspectionWorkbook, loadExportPhoto } from '../services/inspectionExport';
import type { ExportLanguage } from '../services/exportLanguage';
import { photoUrl } from './api';
export interface TaskExportData {
    success: boolean;
    task: {
        id: string;
        hall: string;
        createdAt: string;
        oldVersion: SnapshotVersion;
        newVersion: SnapshotVersion;
    };
    completedCount: number;
    unfinishedCount: number;
    rows: InspectionExportRow[];
}
const labels = {
    zh: { sheet: '任务信息', scope: '库存变动任务现场核查结果（与原库位核查独立）', keys: ['导出范围', '任务 ID', '创建时间', '库厅', '旧 WMS 版本', '新 WMS 参考版本', '已完成库位', '未完成库位'], result: '任务核查结果', all: '全部已完成', differences: '仅差异' },
    en: { sheet: 'Task information', scope: 'Inventory change task field results (independent of original location audits)', keys: ['Export scope', 'Task ID', 'Created at', 'Hall', 'Old WMS version', 'New WMS reference version', 'Completed locations', 'Unfinished locations'], result: 'Task audit results', all: 'All completed', differences: 'Differences only' },
    de: { sheet: 'Aufgabeninformationen', scope: 'Ergebnisse der Bestandsänderungsprüfung (getrennt von ursprünglichen Lagerplatzprüfungen)', keys: ['Exportumfang', 'Aufgaben-ID', 'Erstellt am', 'Halle', 'Alte WMS-Version', 'Neue WMS-Referenzversion', 'Abgeschlossene Plätze', 'Offene Plätze'], result: 'Aufgaben-Prüfergebnisse', all: 'Alle abgeschlossenen', differences: 'Nur Abweichungen' }
};
export async function buildTaskResultWorkbook(data: TaskExportData, loadPhoto: Parameters<typeof buildInspectionWorkbook>[1], language: ExportLanguage = 'zh') {
    const workbook = await buildInspectionWorkbook(data.rows, loadPhoto, language), text = labels[language];
    const metadata = workbook.addWorksheet(text.sheet);
    metadata.columns = [{ width: 32 }, { width: 85 }];
    metadata.addRows(text.keys.map((key, i) => [key, [text.scope, data.task.id, new Date(data.task.createdAt).toLocaleString(), data.task.hall,
            `V${data.task.oldVersion.versionNumber} (${data.task.oldVersion.importId})`, `V${data.task.newVersion.versionNumber} (${data.task.newVersion.importId})`, data.completedCount, data.unfinishedCount][i]]));
    metadata.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };
    metadata.getRow(1).height = 44;
    return workbook;
}
export async function downloadTaskResults(hallId: string, taskId: string, mode: 'all' | 'differences', language: ExportLanguage = 'zh') {
    const response = await fetch(`/api/inventory/change-audit/export?${new URLSearchParams({ hallId, taskId, mode })}`);
    const data = await response.json() as TaskExportData & {
        error?: string;
    };
    if (!response.ok || !data.success || data.task.id !== taskId)
        throw new Error(data.error || 'EXPORT_FAILED');
    const workbook = await buildTaskResultWorkbook(data, id => loadExportPhoto(photoUrl(hallId, taskId, id), true), language);
    const buffer = await workbook.xlsx.writeBuffer({ zip: { compression: 'DEFLATE', compressionOptions: { level: 9 } } });
    const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'), text = labels[language], date = new Date(data.task.createdAt), day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `${day}-${data.task.hall}-${text.result}-${taskId}-V${data.task.oldVersion.versionNumber}-V${data.task.newVersion.versionNumber}-${text[mode]}-${language}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return data;
}
