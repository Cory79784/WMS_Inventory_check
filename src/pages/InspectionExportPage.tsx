import React, { useState } from 'react';
import { HallId } from '../types';

export const InspectionExportPage: React.FC<{ currentHall: HallId }> = ({ currentHall }) => {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleExport = async (mode: 'all' | 'differences') => {
    setExporting(true);
    setError(null);
    try {
      const { downloadInspectionResults } = await import('../services/inspectionExport');
      await downloadInspectionResults(currentHall, mode);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="max-w-2xl mx-auto px-2 sm:px-4 py-3">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 space-y-3">
        <h2 className="font-bold text-slate-800">{currentHall} 核查结果导出</h2>
        <p className="text-xs text-slate-500">仅导出已完成核查的记录，包含已保留的 WMS 历史版本。同一版本重复保存会更新原结果，需留档时请先导出。</p>
        <div className="flex gap-2 text-xs">
          <button type="button" disabled={exporting} onClick={() => handleExport('differences')} className="bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg disabled:opacity-50">仅导出差异</button>
          <button type="button" disabled={exporting} onClick={() => handleExport('all')} className="bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg disabled:opacity-50">导出全部核查结果</button>
        </div>
        {exporting && <p role="status" className="text-xs text-slate-500">导出中…</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
};
