import { t } from '../i18n';
import React, { useState } from 'react';
import { HallId, ExportScope } from '../types';

export const InspectionExportPage: React.FC<{ currentHall: HallId }> = ({ currentHall }) => {
  const [scope, setScope] = useState<ExportScope>('history');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleExport = async (mode: 'all' | 'differences') => {
    setExporting(true);
    setError(null);
    try {
      const { downloadInspectionResults } = await import('../services/inspectionExport');
      await downloadInspectionResults(currentHall, mode, scope);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="max-w-2xl mx-auto px-2 sm:px-4 py-3">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 space-y-3">
        <h2 className="font-bold text-slate-800">{currentHall} {t('originalExport')}</h2>
        <p className="text-xs text-slate-500">{t('exportDescription')}</p>
        <div className="flex flex-wrap gap-3 text-xs">
          <label>{t('exportScopeLabel')}
            <select aria-label={t('exportScopeLabel')} value={scope} disabled={exporting} onChange={event => setScope(event.target.value as ExportScope)} className="ml-2 border rounded p-2">
              <option value="history">{t('exportScopeHistory')}</option><option value="latest">{t('exportScopeLatest')}</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">{t('exportScopeHint')}</p>
        <div className="flex gap-2 text-xs">
          <button type="button" disabled={exporting} onClick={() => handleExport('differences')} className="bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg disabled:opacity-50">{t('differences')}</button>
          <button type="button" disabled={exporting} onClick={() => handleExport('all')} className="bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg disabled:opacity-50">{t('allExport')}</button>
        </div>
        {exporting && <p role="status" className="text-xs text-slate-500">{t('exporting')}</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
};
