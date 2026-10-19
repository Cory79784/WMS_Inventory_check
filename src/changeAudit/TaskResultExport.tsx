import { useState } from 'react';
import { t } from '../i18n';
import type { ExportLanguage } from '../services/exportLanguage';
import type { AuditSession } from './session';
export function TaskResultExport({ session }: {
    session: AuditSession;
}) {
    const [language, setLanguage] = useState<ExportLanguage>('zh'), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const task = session.task, completed = task.plan.targets.filter(t => task.results[t.location]?.completed).length;
    const label = `${new Date(task.createdAt).toLocaleString()} ${t('auditCreated')} · ${task.hall} · V${task.plan.comparison.oldVersion.versionNumber}→V${task.plan.comparison.newVersion.versionNumber} · ${task.id}`;
    const run = async (mode: 'all' | 'differences') => {
        if ((session.dirty && !task.stale) || session.busy)
            return;
        setBusy(true);
        setError('');
        try {
            const { downloadTaskResults } = await import('./taskExport');
            await downloadTaskResults(task.hall, task.id, mode, language);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    return <details className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 space-y-3">
  <summary className="font-bold text-slate-800 cursor-pointer">{t('auditTaskExport')}</summary>
  <p className="text-xs text-slate-500 break-all">{label}</p>
  <p className="text-xs text-slate-500">{t('auditExportPending', { count: task.plan.targets.length - completed })}</p>
  {session.dirty && <p role="status" className="text-xs text-amber-700">{t(task.stale ? 'auditExportSavedOnly' : 'auditExportDirty')}</p>}
  <label className="text-xs">{t('exportLanguageLabel')} <select aria-label={`${t('auditTaskExport')} ${t('exportLanguageLabel')}`} value={language} disabled={busy} onChange={e => setLanguage(e.target.value as ExportLanguage)} className="ml-2 border rounded p-2"><option value="zh">中文</option><option value="en">English</option><option value="de">Deutsch</option></select></label>
  <div className="flex gap-2 text-xs">{(['differences', 'all'] as const).map(mode => <button key={mode} type="button" disabled={busy || (session.dirty && !task.stale) || session.busy} onClick={() => void run(mode)} className="bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg disabled:opacity-50">{t(mode === 'differences' ? 'differences' : 'allExport')}</button>)}</div>
  {busy && <p role="status" className="text-xs text-slate-500">{t('exporting')}</p>}{error && <p role="alert" className="text-xs text-red-600">{error}</p>}
 </details>;
}
