import React from 'react';
import { HallId } from '../types';
import { Warehouse, Shield } from 'lucide-react';

interface HeaderProps {
  currentHall: HallId;
  onSelectHall: (hall: HallId) => void;
  activeView: 'test' | 'import' | 'arch';
  onSelectView: (view: 'test' | 'import' | 'arch') => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentHall,
  onSelectHall,
  activeView,
  onSelectView,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-slate-900 text-white shadow-md">
      <div className="max-w-4xl mx-auto px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Warehouse className="w-5 h-5 text-brand-500" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight">PDA 库存核查</span>
              <span className="text-[10px] bg-brand-500/20 text-brand-300 px-1.5 py-0.2 rounded font-mono border border-brand-500/30">
                Phase 2
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Warehouse PDA Inventory Audit</p>
          </div>
        </div>

        {/* Hall Isolation Selector */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-xs">
            {(['H1', 'H2', 'H3'] as HallId[]).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onSelectHall(h)}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  currentHall === h
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sub Nav Bar */}
      <div className="bg-slate-800/90 border-t border-slate-700/60 px-3 py-1 flex items-center justify-between text-xs max-w-4xl mx-auto">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onSelectView('test')}
            className={`px-2.5 py-1 rounded transition ${
              activeView === 'test'
                ? 'bg-slate-700 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            PDA 设备测试 (Phase 0)
          </button>
          <button
            type="button"
            onClick={() => onSelectView('import')}
            className={`px-2.5 py-1 rounded transition ${
              activeView === 'import'
                ? 'bg-slate-700 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            WMS 版本导入 (Phase 2)
          </button>
          <button
            type="button"
            onClick={() => onSelectView('arch')}
            className={`px-2.5 py-1 rounded transition ${
              activeView === 'arch'
                ? 'bg-slate-700 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            系统架构与规则
          </button>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-slate-400">
          <Shield className="w-3 h-3 text-emerald-400" />
          <span>厅级数据隔离生效</span>
        </div>
      </div>
    </header>
  );
};
