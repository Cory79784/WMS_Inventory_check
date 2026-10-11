import React from 'react';
import { HallId } from '../types';
import { Warehouse, ClipboardCheck, UploadCloud, Cpu, Download } from 'lucide-react';

interface HeaderProps {
  currentHall: HallId;
  onSelectHall: (hall: HallId) => void;
  activeView: 'inspect' | 'test' | 'import' | 'export' | 'arch';
  onSelectView: (view: 'inspect' | 'test' | 'import' | 'export' | 'arch') => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentHall,
  onSelectHall,
  activeView,
  onSelectView,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-slate-900 text-white shadow-md">
      <div className="max-w-3xl mx-auto px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Warehouse className="w-5 h-5 text-blue-400" />
          <span className="font-bold text-sm tracking-tight">PDA 库存核查</span>
        </div>

        {/* Hall Isolation Selector */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-xs font-mono font-bold">
            {(['H1', 'H2', 'H3'] as HallId[]).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onSelectHall(h)}
                className={`px-3 py-1 rounded transition ${
                  currentHall === h
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Operation Tabs Bar */}
      <div className="bg-slate-800/95 border-t border-slate-700/60 px-3 py-1 flex items-center justify-between text-xs max-w-3xl mx-auto">
        <div className="flex gap-1 overflow-x-auto whitespace-nowrap">
          <button
            type="button"
            onClick={() => onSelectView('inspect')}
            className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1 transition ${
              activeView === 'inspect'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            库位核查
          </button>
          <button
            type="button"
            onClick={() => onSelectView('import')}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1 transition ${
              activeView === 'import'
                ? 'bg-slate-700 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            WMS 导入
          </button>
          <button
            type="button"
            onClick={() => onSelectView('export')}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1 transition ${
              activeView === 'export'
                ? 'bg-slate-700 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            导出
          </button>
          <button
            type="button"
            onClick={() => onSelectView('test')}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1 transition ${
              activeView === 'test'
                ? 'bg-slate-700 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            测试
          </button>
        </div>

        <span className="text-[10px] text-slate-400 hidden sm:inline">
          {currentHall} 区域数据隔离
        </span>
      </div>
    </header>
  );
};
