import React, { useState } from 'react';
import { Header } from './components/Header';
import { DeviceTestPage } from './pages/DeviceTestPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { WMSImportPage } from './pages/WMSImportPage';
import { HallId } from './types';

export const App: React.FC = () => {
  const [currentHall, setCurrentHall] = useState<HallId>('H1');
  const [activeView, setActiveView] = useState<'test' | 'import' | 'arch'>('import');

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <Header
        currentHall={currentHall}
        onSelectHall={setCurrentHall}
        activeView={activeView}
        onSelectView={setActiveView}
      />

      <main className="flex-1 pb-8">
        {activeView === 'test' && <DeviceTestPage />}
        {activeView === 'import' && <WMSImportPage currentHall={currentHall} />}
        {activeView === 'arch' && <ArchitecturePage />}
      </main>

      <footer className="text-center py-3 text-[11px] text-slate-400 border-t border-slate-200 bg-white">
        海外仓 PDA 库存核查系统 &copy; {new Date().getFullYear()} &middot; Phase 0 技术可行性验证与硬件测试环境
      </footer>
    </div>
  );
};

export default App;
