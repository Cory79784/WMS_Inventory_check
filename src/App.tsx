import React, { useState } from 'react';
import { Header } from './components/Header';
import { LocationInspectionPage } from './pages/LocationInspectionPage';
import { DeviceTestPage } from './pages/DeviceTestPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { WMSImportPage } from './pages/WMSImportPage';
import { HallId } from './types';

export const App: React.FC = () => {
  const [currentHall, setCurrentHall] = useState<HallId>('H1');
  const [activeView, setActiveView] = useState<'inspect' | 'test' | 'import' | 'arch'>('inspect');

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      <Header
        currentHall={currentHall}
        onSelectHall={setCurrentHall}
        activeView={activeView}
        onSelectView={setActiveView}
      />

      <main className="flex-1 pb-4">
        {activeView === 'inspect' && (
          <LocationInspectionPage
            currentHall={currentHall}
            onOpenImport={() => setActiveView('import')}
            onOpenTest={() => setActiveView('test')}
          />
        )}
        {activeView === 'import' && <WMSImportPage currentHall={currentHall} />}
        {activeView === 'test' && <DeviceTestPage />}
        {activeView === 'arch' && <ArchitecturePage />}
      </main>

      <footer className="text-center py-2.5 text-[11px] text-slate-400 border-t border-slate-200 bg-white">
        海外仓 PDA 库存核查系统 &copy; {new Date().getFullYear()} &middot; 当前操作厅: {currentHall}
      </footer>
    </div>
  );
};

export default App;
